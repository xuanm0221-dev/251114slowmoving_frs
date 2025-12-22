interface SectionTitleProps {
  title: string;
  colorClass?: string;
}

export default function SectionTitle({ title, colorClass = "bg-blue-500" }: SectionTitleProps) {
  return (
    <div className="flex items-center gap-3 mb-6 mt-8">
      <div className={`w-1 h-8 ${colorClass} rounded-full`}></div>
      <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
    </div>
  );
}

