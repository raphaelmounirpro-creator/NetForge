import { Tabs } from "../../components/ui/Tabs";
import { messages } from "../../i18n";
import type { Selection } from "../lab/store";
import { Inspector } from "./Inspector";
import { useObservationStore, type SideTab } from "./observation";
import { RuntimePanel } from "./RuntimePanel";
import type { SimulationSession } from "./store";

const t = messages.simulation;

/** Panneau droit de la vue Simulation : état d'exécution ou inspection d'une décision. */
export function SimulationSidePanel(props: { projectId: string; session: SimulationSession | null; selection: Selection; disabled: boolean }) {
  const side = useObservationStore((state) => state.side);
  return (
    <Tabs<SideTab>
      label={t.rightPanel}
      size="sm"
      tabs={[
        { id: "runtime", label: t.tabRuntime },
        { id: "inspector", label: t.tabInspector },
      ]}
      selected={side}
      onSelect={(tab) => {
        useObservationStore.getState().setSide(tab);
      }}
      className="h-full"
    >
      {side === "runtime" ? (
        <RuntimePanel {...props} />
      ) : (
        <div className="h-full overflow-y-auto p-4">
          {props.session ? <Inspector session={props.session} /> : <p className="text-sm text-text-muted">{t.runtime.notLoaded}</p>}
        </div>
      )}
    </Tabs>
  );
}
