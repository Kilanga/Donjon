import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_AI, type AiConfig, type AiProvider } from './ai.js';
import { DEFAULT_VOICE, type VoiceConfig } from './voice.js';

export interface GameConfig {
  port: number;
  turnSeconds: number; // durée d'un tour
  // Chrono des étages, compté depuis l'ouverture de chaque étage (arrivée du premier crawler ; l'étage 1 : coup d'envoi).
  // Durée et verrou de l'escalier dégressifs, de l'étage 1 à l'avant-dernier ; le dernier étage n'a pas de chrono :
  // la saison s'y termine quand son boss tombe (finalFloorMaxMinutes : filet de sécurité si personne n'y arrive).
  firstFloorMinutes: number; // étage 1 : il s'effondre au bout de N minutes
  lastFloorMinutes: number; // avant-dernier étage : N minutes (les étages entre les deux : dégressif)
  firstLockMinutes: number; // étage 1 : l'escalier reste scellé les N premières minutes
  lastLockMinutes: number; // avant-dernier étage : scellé N minutes
  finalFloorMaxMinutes: number; // dernier étage : effondrement (fin de saison) si le boss tient N minutes
  staggered: boolean;
  lobbySeconds: number; // inscriptions : le premier !join ouvre N secondes d'attente, puis la partie repart à zéro pour tous (0 = pas de salon) // tours décalés : les étages pairs jouent une demi-durée de tour après les impairs (une action toutes les turnSeconds/2 sur le stream)
  respawnTurns: number; // tours avant réapparition
  immunitySeconds: number; // immunité JvJ après réapparition
  roomsPerPlayer: number; // taille d'étage : salles par joueur actif
  minRooms: number; // taille minimale d'un étage
  deathXpLoss: number; // part de l'XP du niveau en cours perdue à la mort (0-1)
  spectatorKey: string; // clé de la régie (vue sans brouillard + commandes MJ) ; 'regie' = clé aléatoire générée
  twitchChannel: string; // chaîne Twitch à écouter ('' = désactivé)
  savePath: string;
  voteEveryMinutes: number; // fréquence des votes de la production (0 = jamais)
  voteTurns: number; // durée d'un vote en tours
  bots: number; // PNJ figurants, toujours présents (0 = aucun)
  closers: number;
  tunnel: boolean; // lance cloudflared et affiche l'adresse publique sur le stream (page 2D pour les viewers) // PNJ retardataires : arrivent après le premier joueur, ne descendent jamais et ferment chaque étage
  finalFloor: number; // dernier étage : son escalier est la sortie du donjon (victoire)
  ai: AiConfig; // IA du donjon (optionnelle) ; la clé API reste dans ANTHROPIC_API_KEY
  voice: VoiceConfig; // voix de Victoria (service local voix/victoria_server.py ; sans lui, sous-titres seuls)
  seed?: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  port: 3000,
  turnSeconds: 20,
  firstFloorMinutes: 25,
  lastFloorMinutes: 15,
  firstLockMinutes: 10,
  lastLockMinutes: 5,
  finalFloorMaxMinutes: 30,
  staggered: true,
  lobbySeconds: 300,
  respawnTurns: 5,
  immunitySeconds: 60,
  roomsPerPlayer: 2,
  minRooms: 20,
  deathXpLoss: 0.25,
  spectatorKey: 'regie',
  twitchChannel: '',
  savePath: 'data/save.json',
  voteEveryMinutes: 4,
  voteTurns: 3,
  bots: 10,
  closers: 4,
  tunnel: false,
  finalFloor: 8,
  ai: { ...DEFAULT_AI },
  voice: { ...DEFAULT_VOICE },
};

/** Charge config.json (s'il existe) puis les variables d'environnement. */
export function loadConfig(root = process.cwd()): GameConfig {
  const cfg: GameConfig = { ...DEFAULT_CONFIG };
  const file = path.join(root, 'config.json');
  if (fs.existsSync(file)) {
    const fromFile = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); // Bloc-notes/PowerShell ajoutent parfois un BOM
    Object.assign(cfg, fromFile);
    cfg.ai = { ...DEFAULT_AI, ...(fromFile.ai ?? {}) };
    cfg.voice = { ...DEFAULT_VOICE, ...(fromFile.voice ?? {}) };
    delete (cfg.ai as unknown as Record<string, unknown>).anthropicKey; // la clé ne se met jamais dans config.json
  }
  const env = process.env;
  const num = (v: string | undefined) => (v !== undefined && v !== '' ? Number(v) : undefined);
  cfg.port = num(env.PORT) ?? cfg.port;
  cfg.turnSeconds = num(env.TURN_SECONDS) ?? cfg.turnSeconds;
  // Test rapide : FLOOR_MINUTES donne la même durée à tous les étages (verrou : un tiers)
  const quick = num(env.FLOOR_MINUTES);
  if (quick !== undefined) {
    cfg.firstFloorMinutes = cfg.lastFloorMinutes = quick;
    cfg.firstLockMinutes = cfg.lastLockMinutes = quick / 3;
  }
  cfg.respawnTurns = num(env.RESPAWN_TURNS) ?? cfg.respawnTurns;
  cfg.immunitySeconds = num(env.IMMUNITY_SECONDS) ?? cfg.immunitySeconds;
  cfg.spectatorKey = env.SPECTATOR_KEY ?? cfg.spectatorKey;
  cfg.twitchChannel = env.TWITCH_CHANNEL ?? cfg.twitchChannel;
  if (env.FINAL_FLOOR) cfg.finalFloor = Math.max(1, Number(env.FINAL_FLOOR) || cfg.finalFloor);
  if (env.BOTS !== undefined && env.BOTS !== '') cfg.bots = Math.max(0, Math.min(30, Number(env.BOTS) || 0));
  if (env.LOBBY_SECONDS !== undefined && env.LOBBY_SECONDS !== '') cfg.lobbySeconds = Math.max(0, Number(env.LOBBY_SECONDS) || 0);
  if (env.STAGGERED) cfg.staggered = env.STAGGERED === '1' || env.STAGGERED === 'true';
  if (env.TUNNEL) cfg.tunnel = env.TUNNEL === '1' || env.TUNNEL === 'true';
  if (env.CLOSERS !== undefined && env.CLOSERS !== '') cfg.closers = Math.max(0, Math.min(10, Number(env.CLOSERS) || 0));
  if (env.AI_PROVIDER && ['off', 'ollama', 'anthropic'].includes(env.AI_PROVIDER)) cfg.ai.provider = env.AI_PROVIDER as AiProvider;
  if (env.OLLAMA_MODEL) cfg.ai.ollamaModel = env.OLLAMA_MODEL;
  if (env.OLLAMA_URL) cfg.ai.ollamaUrl = env.OLLAMA_URL;
  if (env.VOICE) cfg.voice = { ...cfg.voice, enabled: env.VOICE === '1' || env.VOICE === 'true' };
  // En local (Ollama), les appels ne coûtent rien : plus de répliques par minute, sauf réglage explicite
  if (cfg.ai.provider === 'ollama' && cfg.ai.maxPerMinute === DEFAULT_AI.maxPerMinute) cfg.ai.maxPerMinute = 20;
  return cfg;
}
