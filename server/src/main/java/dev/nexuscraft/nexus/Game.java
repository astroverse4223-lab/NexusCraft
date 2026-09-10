package dev.nexuscraft.nexus;

import org.bukkit.Material;

/**
 * One kind of game the server offers.
 *
 * The point of this interface is that BedWars is not special. Everything the
 * hub does — the selector menu, the queue, the countdown, the party that jumps
 * in together, the stats written afterwards — is written against this and knows
 * nothing about beds. Adding Duels or Spleef later means one class implementing
 * this and one line registering it, not another pass through the shell.
 *
 * That is the difference between a server with a game on it and a network.
 */
public interface Game {

    /** Stable id, used in commands and in saved data. Never shown to players. */
    String id();

    /** What it is called on the selector and in chat. */
    String name();

    /** One line under the name, telling somebody who has never played what it is. */
    String blurb();

    /** The icon in the selector menu. */
    Material icon();

    /** Below this the match cannot start; above it, it will not wait. */
    int minPlayers();

    int maxPlayers();

    /**
     * How long the lobby waits once it has enough people, in seconds.
     *
     * Long enough that a full lobby is not a sprint to join, short enough that
     * the minimum-sized one does not feel abandoned.
     */
    default int countdownSeconds() {
        return 20;
    }

    /** A fresh match. Called once per game, by the queue. */
    Match newMatch(Nexus nexus);
}
