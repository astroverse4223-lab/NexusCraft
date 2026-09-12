import { type JSX, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GRASS_TINT, type PaletteBlock } from '@shared/blocks'

/**
 * The build, in three dimensions, with the game's own faces on it.
 *
 * The flat editor beside this one is honest but hard to judge a build in - you
 * paint a layer at a time and hold the shape in your head. Here the shape is
 * just there, and you place and break against what you can see, the way you
 * would in the game.
 *
 * Three things about drawing Minecraft that are easy to get wrong and obvious
 * once wrong: the textures are sixteen pixels across and must not be smoothed,
 * or every block turns to mush; grass is stored greyscale and tinted as it is
 * drawn, so taken at face value it is a grey lid; and a build is thousands of
 * cubes, which is far too many to draw one at a time.
 */

export interface Cell {
  x: number
  y: number
  z: number
  block: string
}

interface Props {
  cells: Cell[]
  palette: PaletteBlock[]
  width: number
  depth: number
  layers: number
  /** What a place puts down. */
  block: string
  onPlace: (cell: Cell) => void
  onBreak: (x: number, y: number, z: number) => void
  /** Middle click, which in the game picks up what you are looking at. */
  onPick: (block: string) => void
}

/** How far the pointer may travel and still count as a click, not a drag. */
const DRAG_SLOP = 5

/** Glass is the only thing here you can see through, and it is worth doing. */
function seeThrough(id: string): boolean {
  return id.endsWith('glass')
}

/**
 * One block's texture, coloured if the game would colour it.
 *
 * Drawn through a canvas rather than loaded straight, because the tinting has
 * to happen to the pixels: grass is a greyscale mask multiplied by a biome
 * colour, with a second mask laid over the sides for the fringe of turf.
 */
async function faceTexture(url: string, options: { tint?: string; overlay?: string } = {}): Promise<THREE.Texture> {
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })

  const base = await load(url)
  const size = base.width || 16

  const canvas = document.createElement('canvas')
  canvas.width = size
  // Animated blocks store their frames stacked in one tall strip; only the
  // first is the block at rest, and the rest would squash into it.
  canvas.height = size

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(base, 0, 0, size, size, 0, 0, size, size)

  if (options.tint) {
    /*
     * Multiply keeps the texture's own shading and takes its colour from the
     * tint, which is exactly what the game does. Painting the colour over the
     * top instead would flatten the grass to a single green square.
     */
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = options.tint
    ctx.fillRect(0, 0, size, size)

    // Multiply also darkened the transparent parts into existence; this puts
    // the original shape back over the result.
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(base, 0, 0, size, size, 0, 0, size, size)
    ctx.globalCompositeOperation = 'source-over'
  }

  if (options.overlay) {
    const mask = await load(options.overlay)

    const tinted = document.createElement('canvas')
    tinted.width = size
    tinted.height = size
    const other = tinted.getContext('2d') as CanvasRenderingContext2D
    other.imageSmoothingEnabled = false
    other.drawImage(mask, 0, 0, size, size, 0, 0, size, size)
    other.globalCompositeOperation = 'multiply'
    other.fillStyle = GRASS_TINT
    other.fillRect(0, 0, size, size)
    other.globalCompositeOperation = 'destination-in'
    other.drawImage(mask, 0, 0, size, size, 0, 0, size, size)

    ctx.drawImage(tinted, 0, 0)
  }

  const texture = new THREE.CanvasTexture(canvas)

  // The whole look depends on these two lines. Sixteen pixels stretched over a
  // block with any smoothing at all stops reading as Minecraft immediately.
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapNearestFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.SRGBColorSpace

  return texture
}

/**
 * The six materials a cube is drawn with, in the order the geometry wants them.
 *
 * A box's faces come out as +x, -x, +y, -y, +z, -z, so the sides repeat around
 * the middle with the top and bottom between them.
 */
async function blockMaterials(block: PaletteBlock): Promise<THREE.Material[]> {
  const side = await faceTexture(block.texture, {
    ...(block.overlay ? { overlay: block.overlay } : {})
  })

  const top = block.top ? await faceTexture(block.top, { ...(block.tintTop ? { tint: GRASS_TINT } : {}) }) : side

  // No stated underside means the two ends match, which is right for a log's
  // rings, a hay bale's cut and a quartz pillar's cap.
  const bottom = block.bottom ? await faceTexture(block.bottom) : top

  const clear = seeThrough(block.id)

  const make = (map: THREE.Texture): THREE.Material =>
    new THREE.MeshLambertMaterial({
      map,
      transparent: clear,
      ...(clear ? { depthWrite: false } : {})
    })

  return [make(side), make(side), make(top), make(bottom), make(side), make(side)]
}

export function BlockCanvas({
  cells,
  palette,
  width,
  depth,
  layers,
  block,
  onPlace,
  onBreak,
  onPick
}: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  /*
   * Everything three.js owns lives in here rather than in state.
   *
   * A scene is not something React can re-render its way to - rebuilding it on
   * every click would drop the camera back to its starting angle mid-build, and
   * the whole point is that you can look at the thing from where you like.
   */
  const kit = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    meshes: THREE.InstancedMesh[]
    floor: THREE.Mesh
    marker: THREE.LineSegments
  } | null>(null)

  const materials = useRef(new Map<string, THREE.Material[]>())

  /** Read by the pointer handlers, which are bound once and outlive a render. */
  const latest = useRef({ cells, block, width, depth, layers, onPlace, onBreak, onPick })
  latest.current = { cells, block, width, depth, layers, onPlace, onBreak, onPick }

  // The scene itself, built once and kept.
  useEffect(() => {
    const mount = host.current
    if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 2000)

    /*
     * Flat, even light from two sides plus a strong ambient.
     *
     * Not realism - the aim is that every face of every block stays readable,
     * because a face you cannot see is a face you cannot click, and a dark
     * corner in a build editor is just somewhere you cannot work.
     */
    scene.add(new THREE.AmbientLight(0xffffff, 1.35))

    const key = new THREE.DirectionalLight(0xffffff, 0.85)
    key.position.set(1, 2.2, 1.4)
    scene.add(key)

    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-1.4, 0.8, -1)
    scene.add(fill)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.maxPolarAngle = Math.PI * 0.92
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    }

    /*
     * The ground the first block goes on.
     *
     * Invisible, but present to the raycaster: without something under the
     * build there is nothing to aim at on an empty canvas, and the studio
     * opens empty every time.
     */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    // The outline around whatever the pointer is over, as the game draws it.
    const marker = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
    )
    marker.visible = false
    scene.add(marker)

    kit.current = { renderer, scene, camera, controls, meshes: [], floor, marker }

    let running = true
    const tick = (): void => {
      if (!running) return
      controls.update()
      renderer.render(scene, camera)
      requestAnimationFrame(tick)
    }
    tick()

    const resize = (): void => {
      if (!mount.clientWidth || !mount.clientHeight) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    return () => {
      running = false
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      kit.current = null
    }
  }, [])

  // Frame the build whenever its extent changes, not on every block placed.
  useEffect(() => {
    const current = kit.current
    if (!current) return

    const { camera, controls, floor } = current

    floor.scale.set(width, depth, 1)
    floor.position.set(width / 2, 0, depth / 2)

    const centre = new THREE.Vector3(width / 2, Math.min(layers, 6) / 2, depth / 2)
    controls.target.copy(centre)

    const span = Math.max(width, depth)
    camera.position.set(centre.x + span * 0.9, centre.y + span * 0.75, centre.z + span * 1.15)
    camera.lookAt(centre)
    controls.update()
  }, [width, depth, layers])

  // The blocks themselves, rebuilt when what is placed changes.
  useEffect(() => {
    let dropped = false

    void (async () => {
      const current = kit.current
      if (!current || palette.length === 0) return

      const byId = new Map<string, PaletteBlock>(palette.map((entry) => [entry.id, entry]))

      /*
       * One mesh per kind of block, holding every copy of it.
       *
       * A build is thousands of cubes and a draw call each would crawl. Grouped
       * this way it is one call per distinct block - a dozen or so, however big
       * the build gets.
       */
      const grouped = new Map<string, Cell[]>()
      for (const cell of cells) {
        const list = grouped.get(cell.block)
        if (list) list.push(cell)
        else grouped.set(cell.block, [cell])
      }

      // Load any texture this build needs and has not needed before.
      for (const id of grouped.keys()) {
        if (materials.current.has(id)) continue
        const entry = byId.get(id)
        if (!entry) continue
        materials.current.set(id, await blockMaterials(entry))
      }

      if (dropped || !kit.current) return

      for (const mesh of current.meshes) {
        current.scene.remove(mesh)
        mesh.geometry.dispose()
      }
      current.meshes = []

      const geometry = new THREE.BoxGeometry(1, 1, 1)
      const matrix = new THREE.Matrix4()

      for (const [id, group] of grouped) {
        const faces = materials.current.get(id)
        if (!faces) continue

        const mesh = new THREE.InstancedMesh(geometry.clone(), faces, group.length)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

        group.forEach((cell, index) => {
          matrix.setPosition(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5)
          mesh.setMatrixAt(index, matrix)
        })

        mesh.instanceMatrix.needsUpdate = true
        // Kept so a ray that hits instance 12 can say which block that is.
        mesh.userData.cells = group

        current.scene.add(mesh)
        current.meshes.push(mesh)
      }

      geometry.dispose()
    })()

    return () => {
      dropped = true
    }
  }, [cells, palette])

  // Pointer handling: aim, outline, place, break.
  useEffect(() => {
    const current = kit.current
    if (!current) return

    const canvas = current.renderer.domElement
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    /** Where the button went down, to tell a click from a camera drag. */
    let down: { x: number; y: number; button: number } | null = null

    const aimed = (
      event: PointerEvent | MouseEvent
    ): { cell: Cell | null; next: { x: number; y: number; z: number } | null } => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, current.camera)

      const hits = raycaster.intersectObjects([...current.meshes, current.floor], false)
      const hit = hits[0]
      if (!hit || !hit.face) return { cell: null, next: null }

      if (hit.object === current.floor) {
        // The ground: the cell is whichever square of it was hit.
        const x = Math.floor(hit.point.x)
        const z = Math.floor(hit.point.z)
        return { cell: null, next: { x, y: 0, z } }
      }

      const mesh = hit.object as THREE.InstancedMesh
      const group = mesh.userData.cells as Cell[] | undefined
      const cell = group && hit.instanceId !== undefined ? group[hit.instanceId] : undefined
      if (!cell) return { cell: null, next: null }

      /*
       * Which way the hit face points says where a new block goes - against
       * that face, the way placing works in the game. The normal comes back in
       * the mesh's own space, which for these is the world's.
       */
      const normal = hit.face.normal
      return {
        cell,
        next: {
          x: cell.x + Math.round(normal.x),
          y: cell.y + Math.round(normal.y),
          z: cell.z + Math.round(normal.z)
        }
      }
    }

    const move = (event: PointerEvent): void => {
      const { cell, next } = aimed(event)

      /*
       * The outline sits on the block being pointed at, which is the one a
       * left click breaks and the one a right click builds against - the same
       * box the game draws, meaning the same thing.
       *
       * On bare ground there is no block to outline, so it falls to the square
       * the first one would land on.
       */
      const show = cell ?? next

      current.marker.visible = show !== null
      if (show) current.marker.position.set(show.x + 0.5, show.y + 0.5, show.z + 0.5)
    }

    const press = (event: PointerEvent): void => {
      // Chromium turns a middle press into scroll-by-drag, which here would
      // fight the camera and swallow the pick.
      if (event.button === 1) event.preventDefault()
      down = { x: event.clientX, y: event.clientY, button: event.button }
    }

    const release = (event: PointerEvent): void => {
      const start = down
      down = null
      if (!start || start.button !== event.button) return

      // Moved far enough and it was the camera being turned, not a click.
      const travelled = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      if (travelled > DRAG_SLOP) return

      const { cell, next } = aimed(event)
      const state = latest.current

      // Left breaks, right places, middle picks up what it is pointed at.
      // That is the game's mapping and people do not relearn it for one screen.
      if (event.button === 0) {
        if (cell) state.onBreak(cell.x, cell.y, cell.z)
        return
      }

      if (event.button === 1) {
        if (cell) state.onPick(cell.block)
        return
      }

      if (event.button !== 2 || !next) return

      /*
       * Refused rather than clamped when it falls outside the build.
       *
       * Clamping would stack the block against the wall you aimed past, which
       * looks like the editor deciding where your block goes.
       */
      if (next.x < 0 || next.x >= state.width) return
      if (next.z < 0 || next.z >= state.depth) return
      if (next.y < 0 || next.y >= state.layers) return

      state.onPlace({ ...next, block: state.block })
    }

    const noMenu = (event: MouseEvent): void => event.preventDefault()

    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerdown', press)
    canvas.addEventListener('pointerup', release)
    const leave = (): void => {
      current.marker.visible = false
    }

    canvas.addEventListener('contextmenu', noMenu)
    canvas.addEventListener('pointerleave', leave)

    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerdown', press)
      canvas.removeEventListener('pointerup', release)
      canvas.removeEventListener('contextmenu', noMenu)
      canvas.removeEventListener('pointerleave', leave)
    }
  }, [])

  return <div ref={host} className="block-canvas" />
}
