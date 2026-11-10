import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { messages } from "../../i18n";

const t = messages.shortcuts;

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      title={t.title}
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          {t.close}
        </Button>
      }
    >
      <table className="w-full border-collapse text-sm">
        <tbody>
          {t.items.map(([keys, action]) => (
            <tr key={keys} className="border-b border-border">
              <th scope="row" className="py-2 pr-4 text-left font-mono text-xs font-semibold whitespace-nowrap text-text">
                {keys}
              </th>
              <td className="py-2 text-text-muted">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs">{t.note}</p>
    </Dialog>
  );
}
