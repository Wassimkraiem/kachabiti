import { UseFormRegister, FieldError, FieldValues, Path } from "react-hook-form";

interface Option {
    value: string;
    label: string;
}

interface FormSelectProps<T extends FieldValues = FieldValues> {
    label: string;
    name: Path<T>;
    options: Option[];
    register: UseFormRegister<T>;
    error?: FieldError;
    required?: boolean;
    className?: string;
}

export default function FormSelect<T extends FieldValues = FieldValues>({
    label,
    name,
    options,
    register,
    error,
    required = false,
    className = "",
}: FormSelectProps<T>) {
    return (
        <div className={className}>
            <label className="block text-sm font-medium text-ink mb-2">
                {label}
                {required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
                {...register(name)}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition text-ink ${error
                    ? "border-red-500 focus:ring-red-500"
                    : "border-line"
                    }`}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            {error && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                        />
                    </svg>
                    {error.message}
                </p>
            )}
        </div>
    );
}

