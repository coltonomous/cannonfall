#!/usr/bin/env node
/**
 * bridge.js — JSON-line protocol over stdin/stdout.
 *
 * Python spawns this process and exchanges one-line JSON messages:
 *
 *   → { "cmd": "reset", "options": { "mode": "CASTLE" } }
 *   ← { "ok": true, "observation": { ... } }
 *
 *   → { "cmd": "step", "action": { "yaw": 0.1, "pitch": 0.5, "power": 30 } }
 *   ← { "ok": true, "observation": { ... }, "reward": 0.5, "done": false, "info": { ... } }
 *
 *   → { "cmd": "close" }
 *   ← { "ok": true }
 *
 *   → { "cmd": "get_config" }
 *   ← { "ok": true, "config": { ... } }
 */

import * as readline from 'readline';
import {
  HeadlessGame, GAME_MODES,
  MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET, MIN_POWER, MAX_POWER,
} from './HeadlessGame.js';

let game = null;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleMessage(msg) {
  try {
    const { cmd, ...params } = JSON.parse(msg);

    switch (cmd) {
      case 'reset': {
        const options = params.options || {};
        game = new HeadlessGame(options);
        const observation = game.reset();
        send({ ok: true, observation });
        break;
      }

      case 'step': {
        if (!game) {
          send({ ok: false, error: 'No active game — call reset first' });
          break;
        }
        const result = game.step(params.action, params.opponentAction);
        // Include opponent observation for self-play
        if (game.opponentPolicy === 'self') {
          result.opponentObservation = game.getOpponentObservation();
        }
        send({ ok: true, ...result });
        break;
      }

      case 'get_config': {
        send({
          ok: true,
          config: {
            modes: Object.keys(GAME_MODES),
            actionSpace: {
              yaw:   { min: -MAX_YAW_OFFSET, max: MAX_YAW_OFFSET },
              pitch: { min: MIN_PITCH, max: MAX_PITCH },
              power: { min: MIN_POWER, max: MAX_POWER },
            },
          },
        });
        break;
      }

      case 'play_game': {
        // Play a full game with optional blueprint DNA castles.
        // Player 0 (attacker) fires using provided actions or heuristic.
        // Player 1 (defender) fires via configured opponent policy.
        //
        // params:
        //   options.blueprintDNA: [dnaP0, dnaP1] — 32-float arrays or null
        //   options.attackerDifficulty: AI difficulty for player 0 ('EASY'|'MEDIUM'|'HARD')
        //   attackerActions: [{yaw,pitch,power}, ...] — optional per-turn overrides
        //
        // Returns: { ok, result: { winner, hp, turnCount, blocksDestroyed } }
        const options = params.options || {};
        const attackerDifficulty = options.attackerDifficulty || 'HARD';
        const g = new HeadlessGame(options);
        g.reset();

        const attackerActions = params.attackerActions || null;
        const earlyStopHits = options.earlyStopHits || 0;
        const earlyStopTurns = options.earlyStopTurns || 0;
        let totalBlocksDestroyed = 0;
        let attackerHits = 0;
        let turn = 0;

        while (!g.done) {
          let action;
          if (attackerActions && attackerActions[turn]) {
            action = attackerActions[turn];
          } else {
            // Use heuristic AI for player 0 (attacker)
            action = g.getHeuristicAction(0, attackerDifficulty);
          }
          const stepResult = g.step(action);
          totalBlocksDestroyed += stepResult.info.blocksDestroyed || 0;
          if (stepResult.info.hit) attackerHits++;
          turn++;

          // Early termination: castle is clearly weak
          if (earlyStopHits > 0 && attackerHits >= earlyStopHits && turn <= earlyStopTurns) {
            break;
          }
        }

        send({
          ok: true,
          result: {
            winner: g.winner,
            hp: [...g.hp],
            turnCount: g.turnCount,
            blocksDestroyed: totalBlocksDestroyed,
          },
        });
        break;
      }

      case 'close': {
        send({ ok: true });
        process.exit(0);
        break;
      }

      default:
        send({ ok: false, error: `Unknown command: ${cmd}` });
    }
  } catch (err) {
    send({ ok: false, error: err.message });
  }
}

// Read JSON lines from stdin
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', handleMessage);
rl.on('close', () => process.exit(0));
