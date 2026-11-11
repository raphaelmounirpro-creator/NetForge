import { z } from "zod";
import { create } from "zustand";

/**
 * Lien entre un projet du laboratoire et une tentative d'évaluation, avec
 * les réponses en cours de saisie (enregistrés sur l'appareil, relus comme
 * données externes). Les réponses ne sont corrigées que par le serveur, à la
 * soumission : les garder localement ne révèle rien.
 */
const linkSchema = z.strictObject({
  code: z.string().regex(/^[a-z2-7]{12}$/),
  attemptId: z.uuid(),
  answers: z.record(z.string().regex(/^\d{1,2}$/), z.string().max(64)),
});
export type EvaluationLink = z.infer<typeof linkSchema>;

const keyOf = (projectId: string) => `netforge.evaluation.${projectId}`;

function read(projectId: string): EvaluationLink | null {
  try {
    const raw = localStorage.getItem(keyOf(projectId));
    if (raw === null) return null;
    const parsed = linkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(projectId: string, link: EvaluationLink): void {
  try {
    localStorage.setItem(keyOf(projectId), JSON.stringify(link));
  } catch {
    // Stockage indisponible : le lien vaut pour la session.
  }
}

interface LinkState {
  links: Readonly<Record<string, EvaluationLink | null>>;
  load: (projectId: string) => EvaluationLink | null;
  save: (projectId: string, link: EvaluationLink) => void;
  setAnswer: (projectId: string, step: number, value: string) => void;
}

export const useEvaluationLinks = create<LinkState>()((set, get) => ({
  links: {},
  load: (projectId) => {
    const known = get().links[projectId];
    if (known !== undefined) return known;
    const loaded = read(projectId);
    set((state) => ({ links: { ...state.links, [projectId]: loaded } }));
    return loaded;
  },
  save: (projectId, link) => {
    write(projectId, link);
    set((state) => ({ links: { ...state.links, [projectId]: link } }));
  },
  setAnswer: (projectId, step, value) => {
    const link = get().load(projectId);
    if (!link) return;
    get().save(projectId, { ...link, answers: { ...link.answers, [String(step)]: value } });
  },
}));
