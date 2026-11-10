// Remonte au serveur (journal de session) les erreurs JavaScript de la page et sa fluidité.
import type { ClientMsg } from '../../src/shared/types';

type Sender = (m: ClientMsg) => boolean; // renvoie false si la connexion n'est pas prête

const queue: ClientMsg[] = [];
let sender: Sender | null = null;
let page = location.pathname;
let sent = 0;

function push(m: ClientMsg) {
  if (sender && sender(m)) return;
  if (queue.length < 20) queue.push(m);
}

/** À appeler à chaque (re)connexion : vide la file d'attente. */
export function telemetryReady() {
  while (queue.length && sender && sender(queue[0])) queue.shift();
}

export function reportError(message: string, stack?: string, where?: string) {
  if (++sent > 40) return; // pas d'avalanche
  push({ type: 'clientError', message: String(message).slice(0, 500), stack: stack?.slice(0, 1500), where, page });
}

export function initTelemetry(send: Sender, pageName: string) {
  sender = send;
  page = pageName;
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    // Erreur de chargement d'image/script : e.message vide, la cible donne la ressource
    const target = e.target as HTMLElement | null;
    if (!e.message && target && target !== (window as unknown as HTMLElement)) {
      reportError(`ressource introuvable : ${(target as HTMLImageElement).src ?? target.tagName}`, undefined, 'chargement');
      return;
    }
    reportError(e.message || String(err), err?.stack, `${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}`);
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    reportError(`promesse rejetée : ${r?.message ?? String(r)}`, r?.stack);
  });

  // Images/seconde : mesurées sur 10 s, envoyées toutes les 2 minutes (et 20 s après l'ouverture)
  let frames = 0;
  let t0 = performance.now();
  let last = 0;
  const count = () => {
    frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  setInterval(() => {
    const now = performance.now();
    const fps = Math.round((frames * 10000) / (now - t0)) / 10;
    frames = 0;
    t0 = now;
    if (document.hidden) return; // onglet en arrière-plan : mesure sans intérêt
    if (now - last < 120000 && last !== 0) return;
    if (last === 0 && now < 20000) return;
    last = now;
    push({ type: 'clientPerf', fps, w: innerWidth, h: innerHeight, page });
  }, 10000);
}
