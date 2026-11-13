import { analyzeOptics, analyzePon, worstStatus, type OpticalReport, type OpticalStatus, type PonReport } from "@netforge/engine";
import { getModel, isOptical, type NfgDocument } from "@netforge/project";
import { useEffect, useMemo } from "react";
import { useExerciseStore } from "../exercises/progress";

/** Bilan optique du document (calcul statique du moteur, recalculé à chaque modification). */
export function useOpticalReport(doc: NfgDocument): OpticalReport {
  return useMemo(() => analyzeOptics(doc), [doc]);
}

/** Activation des ONT (calcul statique du moteur, à partir du bilan optique). */
export function usePonReport(doc: NfgDocument, report: OpticalReport): PonReport {
  return useMemo(() => analyzePon(doc, report), [doc, report]);
}

/** Vrai si le projet est un exercice : les pannes sont alors masquées. */
export function useIsExercise(projectId: string): boolean {
  const progress = useExerciseStore((state) => state.progress[projectId]);
  useEffect(() => {
    useExerciseStore.getState().load(projectId);
  }, [projectId]);
  return progress !== undefined && progress !== null;
}

export function isOpticalDevice(doc: NfgDocument, deviceId: string): boolean {
  const device = doc.topology.devices.find((item) => item.id === deviceId);
  return device !== undefined && isOptical(getModel(device.model).kind);
}

/** État le plus défavorable des chemins de chaque ONT atteint. */
export function ontStatuses(report: OpticalReport): Map<string, OpticalStatus> {
  const byOnt = new Map<string, OpticalStatus[]>();
  for (const path of report.paths) byOnt.set(path.ont.deviceId, [...(byOnt.get(path.ont.deviceId) ?? []), path.status]);
  return new Map([...byOnt].map(([ontId, statuses]) => [ontId, worstStatus(statuses)]));
}
