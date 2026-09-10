import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLogger } from '../../core/logger'

const run = promisify(execFile)
const log = createLogger('firewall')

/**
 * The other half of opening a port.
 *
 * Forwarding a port on the router only gets a connection as far as this machine.
 * Windows Firewall then decides whether anything is allowed to receive it, and
 * on a default install the answer for a Java process nobody has approved is no -
 * inbound is blocked unless something says otherwise, and blocked traffic is
 * dropped silently.
 *
 * That combination is the worst possible one to debug: the router reports the
 * mapping as open, the server reports itself as listening, and every friend sees
 * a connection that times out with nothing in any log to explain it. It looked
 * exactly like the port forwarding having failed when the port forwarding was
 * the part that worked.
 *
 * Adding a rule needs administrator rights, which the launcher does not have and
 * should not quietly ask for. So this reports honestly what it could and could
 * not do, and hands back the command to run by hand when it could not.
 */

/** What the rules are called, so they can be found and removed again. */
const RULE_PREFIX = 'NexusCraft server'

export interface FirewallResult {
  /** Whether inbound traffic on this port is now allowed. */
  allowed: boolean
  /** Whether a rule already existed, so nothing needed doing. */
  alreadyThere: boolean
  /** Why it could not be done, when it could not. */
  reason: string | null
  /** The command to run by hand, when the launcher could not do it itself. */
  manualCommand: string | null
}

const ruleName = (port: number): string => `${RULE_PREFIX} (TCP ${port})`

/** The command a person would run themselves, in an administrator terminal. */
export function manualCommandFor(port: number): string {
  return (
    `New-NetFirewallRule -DisplayName "${ruleName(port)}" ` +
    `-Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port}`
  )
}

/** Runs a command and hands back what it said, without throwing. */
async function command(
  file: string,
  args: string[]
): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run(file, args, {
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 8 * 1024 * 1024
    })
    return { ok: true, out: stdout }
  } catch (err) {
    return { ok: false, out: String((err as { stderr?: string })?.stderr || err) }
  }
}

async function powershell(script: string): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      // Generous, because this is a safety net rather than a schedule: a
      // timeout here comes back as "no rule found", which is the wrong answer
      // rather than a slow one.
      { windowsHide: true, timeout: 45_000 }
    )
    return { ok: true, out: stdout.trim() }
  } catch (err) {
    const out = String((err as { stderr?: string })?.stderr || err)
    return { ok: false, out: out.trim() }
  }
}

/**
 * Whether anything already lets this port through.
 *
 * Deliberately broader than the launcher's own rule: somebody may have allowed
 * Java by hand, or accepted the prompt Windows shows the first time a program
 * listens. Adding a second rule on top of a working one is noise.
 */
/**
 * Whether anything already lets this port through.
 *
 * Deliberately broader than the launcher's own rule: somebody may have allowed
 * Java by hand, or accepted the prompt Windows shows the first time a program
 * listens. Adding a second rule on top of a working one is noise.
 *
 * Two shapes of rule count, and only two. A rule scoped to this port, which is
 * what the launcher and the manual command create; and a rule for a java binary
 * covering any port, which is what Windows makes when somebody clicks Allow on
 * its prompt. Nothing else - a system rule with no program attached says nothing
 * about java, and another program's open door is not this one's.
 */
export async function isAllowed(port: number): Promise<boolean> {
  if (process.platform !== 'win32') return true

  const dump = await netshRules()

  if (dump.length > 0) return dump.some((rule) => letsThrough(rule, port))

  /*
   * netsh could not be read, which on a non-English Windows means its labels
   * are not the ones parsed above. The slow scan is correct in every locale.
   */
  log.info('reading the firewall with PowerShell instead of netsh')
  return await slowIsAllowed(port)
}

/** One rule, as netsh describes it. */
interface Rule {
  enabled: boolean
  inbound: boolean
  allow: boolean
  protocol: string
  ports: string[]
  program: string
}

/**
 * Every inbound rule, read in one go.
 *
 * netsh rather than Get-NetFirewallRule because the PowerShell route needs a
 * separate lookup per rule to find its ports - six hundred of them, twenty-two
 * seconds - while this is one process and one parse.
 */
async function netshRules(): Promise<Rule[]> {
  /*
   * verbose, because the default output has no Program line at all.
   *
   * Without it the only rules that could ever match are port-scoped ones - and
   * the rule Windows writes when somebody clicks Allow on its prompt is scoped
   * to the program with no port, so the most common way a server gets allowed
   * would have been invisible. It costs about a tenth of a second.
   */
  const { ok, out } = await command('netsh', [
    'advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in', 'verbose'
  ])

  if (!ok) return []

  const rules: Rule[] = []
  let current: Record<string, string> | null = null

  const finish = (): void => {
    if (!current) return

    // A block with no protocol is a heading or a summary, not a rule.
    if (current.protocol) {
      rules.push({
        enabled: /^yes$/i.test(current.enabled || ''),
        inbound: /^in$/i.test(current.direction || ''),
        allow: /^allow$/i.test(current.action || ''),
        protocol: current.protocol,
        ports: (current.localport || '').split(',').map((p) => p.trim()),
        program: current.program || ''
      })
    }
    current = null
  }

  for (const line of out.split(/\r?\n/)) {
    const pair = /^([^:]+):\s*(.*)$/.exec(line.trim())
    if (!pair) continue

    const key = pair[1].trim().toLowerCase().replace(/\s+/g, '')
    const value = pair[2].trim()

    if (key === 'rulename') {
      finish()
      current = {}
      continue
    }
    if (current) current[key] = value
  }
  finish()

  return rules
}

/** Whether one rule opens this port for a Minecraft server. */
function letsThrough(rule: Rule, port: number): boolean {
  if (!rule.enabled || !rule.inbound || !rule.allow) return false
  if (!/^(tcp|any)$/i.test(rule.protocol)) return false

  if (rule.ports.includes(String(port))) return true

  // A rule covering every port only counts when it belongs to java, which is
  // the rule Windows writes when somebody allows the server at its prompt.
  const everyPort = rule.ports.some((p) => /^any$/i.test(p))
  return everyPort && /java/i.test(rule.program)
}

/**
 * The same question asked through PowerShell, for locales netsh cannot be
 * parsed in.
 *
 * Correct but slow: it has to ask each rule for its ports separately, because
 * enumerating the port filters directly misses some of them entirely.
 */
async function slowIsAllowed(port: number): Promise<boolean> {
  const inbound =
    `$r.Enabled -eq 'True' -and $r.Direction -eq 'Inbound' -and $r.Action -eq 'Allow'`

  const { ok, out } = await powershell(
    `$hit = $false; ` +
      `foreach ($r in Get-NetFirewallRule -Direction Inbound -Enabled True ` +
      `-Action Allow -ErrorAction SilentlyContinue) { ` +
      `  if ($hit) { continue } ` +
      `  if (-not (${inbound})) { continue } ` +
      `  $f = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue; ` +
      `  if (-not $f) { continue } ` +
      `  if ($f.Protocol -ne 'TCP' -and $f.Protocol -ne 'Any') { continue } ` +
      `  $ports = @($f.LocalPort); ` +
      `  if ($ports -contains '${port}') { $hit = $true; continue } ` +
      `  if (-not ($ports -contains 'Any')) { continue } ` +
      `  $a = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue; ` +
      `  if ("$($a.Program)" -match 'java') { $hit = $true } ` +
      `} ; if ($hit) { 'yes' } else { 'no' }`
  )

  return ok && out.includes('yes')
}

/**
 * Lets inbound connections on this port through, if it can.
 *
 * Never elevates on its own. A launcher that raises an administrator prompt
 * because somebody pressed a button about a game server is a launcher people
 * stop trusting, so when it cannot do it the answer is the command and an
 * explanation rather than a prompt.
 */
export async function allow(port: number, serverName: string): Promise<FirewallResult> {
  if (process.platform !== 'win32') {
    return { allowed: true, alreadyThere: true, reason: null, manualCommand: null }
  }

  if (await isAllowed(port)) {
    log.info(`inbound TCP ${port} is already allowed through the firewall`)
    return { allowed: true, alreadyThere: true, reason: null, manualCommand: null }
  }

  const name = ruleName(port)
  const { ok, out } = await powershell(
    `New-NetFirewallRule -DisplayName "${name}" ` +
      `-Description "Lets friends reach ${serverName.replace(/"/g, '')}." ` +
      `-Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} ` +
      `-Profile Any -ErrorAction Stop | Out-Null; 'added'`
  )

  if (ok && out.includes('added')) {
    log.info(`allowed inbound TCP ${port} through the firewall`)
    return { allowed: true, alreadyThere: false, reason: null, manualCommand: null }
  }

  /*
   * Almost always a lack of administrator rights, which is expected rather than
   * exceptional - so it is reported as something to do, not as a failure.
   */
  const denied = /access is denied|requires elevation|not authorized|0x80070005/i.test(out)

  log.warn(`could not add a firewall rule for ${port}: ${out.slice(0, 200)}`)

  return {
    allowed: false,
    alreadyThere: false,
    reason: denied
      ? 'the launcher is not running as an administrator'
      : out.split('\n')[0]?.slice(0, 160) || 'the rule could not be added',
    manualCommand: manualCommandFor(port)
  }
}

/**
 * Takes the rule away again.
 *
 * Only ever removes the launcher's own rule, by name. A rule somebody added
 * themselves is theirs, and closing a port in the launcher is not a reason to
 * undo a decision made outside it.
 */
export async function revoke(port: number): Promise<boolean> {
  if (process.platform !== 'win32') return true

  const { ok } = await powershell(
    `Remove-NetFirewallRule -DisplayName "${ruleName(port)}" ` +
      `-ErrorAction SilentlyContinue; 'done'`
  )

  if (ok) log.info(`removed the firewall rule for TCP ${port}`)
  return ok
}
