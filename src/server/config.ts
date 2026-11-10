import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_AI, type AiConfig, type AiProvider } from './ai.js';

export interface GameConfig {
  port: number;
  turnSeconds: number; // durée d'un tour
  floorMinutes: number; // durée de vie d'un étage avant effondrement
  respawnTurns: number; // tours avant réapparition
  immunitySeconds: number; // immunité JvJ après réapparition
  roomsPerPlayer: number; // taille d'étage : salles par joueur actif
  minRooms: number; // taille minimale d'un étage
  deathXpLoss: number; // part de l'XP du niveau en cours perdue à la mort (0-1)
  spectatorKey: string; // clé pour la vue spectateur (sans brouillard)
  twitchChannel: string; // chaîne Twitch à écouter ('' = désactivé)
  savePath: string;
  ai: AiConfig; // IA du donjon (optionnelle) ; la clé API reste dans ANTHROPIC_API_KEY
  seed?: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  port: 3000,
  turnSeconds: 20,
  floorMinutes: 15,
  respawnTurns: 5,
  immunitySeconds: 180,
  roomsPerPlayer: 2,
  minRooms: 20,
  deathXpLoss: 0.25,
  spectatorKey: 'regie',
  twitchChannel: '',
  savePath: 'data/save.json',
  ai: { ...DEFAULT_AI },
};

/** Charge config.json (s'il existe) puis les variables d'environnement. */
export function loadConfig(root = process.cwd()): GameConfig {
  const cfg: GameConfig = { ...DEFAULT_CONFIG };
  const file = path.join(root, 'config.json');
  if (fs.existsSync(file)) {
    const fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(cfg, fromFile);
    cfg.ai = { ...DEFAULT_AI, ...(fromFile.ai ?? {}) };
    delete (cfg.ai as unknown as Record<string, unknown>).anthropicKey; // la clé ne se met jamais dans config.json
  }
  const env = process.env;
  const num = (v: string | undefined) => (v !== undefined && v !== '' ? Number(v) : undefined);
  cfg.port = num(env.PORT) ?? cfg.port;
  cfg.turnSeconds = num(env.TURN_SECONDS) ?? cfg.turnSeconds;
  cfg.floorMinutes = num(env.FLOOR_MINUTES) ?? cfg.floorMinutes;
  cfg.respawnTurns = num(env.RESPAWN_TURNS) ?? cfg.respawnTurns;
  cfg.immunitySeconds = num(env.IMMUNITY_SECONDS) ?? cfg.immunitySeconds;
  cfg.spectatorKey = env.SPECTATOR_KEY ?? cfg.spectatorKey;
  cfg.twitchChannel = env.TWITCH_CHANNEL ?? cfg.twitchChannel;
  if (env.AI_PROVIDER && ['off', 'ollama', 'anthropic'].includes(env.AI_PROVIDER)) cfg.ai.provider = env.AI_PROVIDER as AiProvider;
  if (env.OLLAMA_MODEL) cfg.ai.ollamaModel = env.OLLAMA_MODEL;
  if (env.OLLAMA_URL) cfg.ai.ollamaUrl = env.OLLAMA_URL;
  return cfg;
}
