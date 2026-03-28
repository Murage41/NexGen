import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  back?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
}

export default function PageHeader({ title, back, onBack, right }: Props) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {back && (
          <button onClick={() => onBack ? onBack() : navigate(-1)} className="p-1 -ml-1 text-gray-600">
            <ArrowLeft size={22} />
          </button>
        )}
        <h1 className="text-xl font-bold text-gray-800">{title}</h1>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
