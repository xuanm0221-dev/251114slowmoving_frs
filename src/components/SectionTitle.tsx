interface SectionTitleProps {
  title: string;
  subtitle?: string;
  colorClass?: string;
}

export default function SectionTitle({ title, subtitle, colorClass = "bg-blue-500" }: SectionTitleProps) {
  return (
    <div className="flex items-center gap-3 mb-6 mt-8">
      <div className={`w-1 h-8 ${colorClass} rounded-full`}></div>
      <div className="flex flex-col">
        <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
        {subtitle && (
          <span className="text-sm text-gray-400 mt-0.5">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

