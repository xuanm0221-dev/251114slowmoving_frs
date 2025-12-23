interface BilingualLabelProps {
  primary: string;
  secondary: string;
  align?: 'left' | 'center' | 'right';
}

export default function BilingualLabel({ 
  primary, 
  secondary, 
  align = 'left' 
}: BilingualLabelProps) {
  const alignClass = align === 'center' ? 'items-center' : align === 'right' ? 'items-end' : 'items-start';
  const textAlign = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  
  return (
    <div className={`flex flex-col ${alignClass}`}>
      <span className={textAlign}>{primary}</span>
      <span className={`text-gray-400 text-[11px] leading-tight ${textAlign}`} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {secondary}
      </span>
    </div>
  );
}

