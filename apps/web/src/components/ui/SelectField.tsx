import { useId, type SelectHTMLAttributes } from "react";

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  options: readonly { readonly value: string; readonly label: string }[];
}

/** Liste déroulante native avec libellé persistant. */
export function SelectField({ label, options, className = "", ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
      </label>
      <select id={id} className="min-h-9 w-full rounded-sm border border-border-strong bg-canvas px-2 text-sm text-text disabled:opacity-60" {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
