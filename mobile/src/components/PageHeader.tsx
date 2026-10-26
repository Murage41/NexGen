import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  back?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
}

// The navy band at the top of every phone page (it bleeds over the page's
// px-4 pt-4 padding set in App.tsx).
export default function PageHeader({ title, back, onBack, right }: Props) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between -mx-4 -mt-4 mb-4 px-4 py-3.5 bg-gray-900 text-white">
      <div className="flex items-center gap-2 min-w-0">
        {back && (
          <button onClick={() => onBack ? onBack() : navigate(-1)} className="p-1 -ml-1 text-blue-200" aria-label="Back">
            <ArrowLeft size={22} />
          </button>
        )}
        <h1 className="text-lg font-bold text-white truncate">{title}</h1>
      </div>
      {right && <div className="text-white [&_svg]:text-white">{right}</div>}
    </div>
  );
}
