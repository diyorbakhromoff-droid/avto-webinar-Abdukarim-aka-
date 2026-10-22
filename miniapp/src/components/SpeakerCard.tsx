import { useState } from 'react';
import type { FunnelBrand } from '../api/types';

function initials(name: string): string {
  const parts = name.replace(/[[\]]/g, '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

export function SpeakerCard({ funnel }: { funnel: FunnelBrand }) {
  const [broken, setBroken] = useState(false);
  const photo = funnel.speaker_photo_url && !broken ? funnel.speaker_photo_url : null;
  return (
    <div className="speaker card-flat">
      <div className="speaker__photo">
        {photo ? (
          <img src={photo} alt="" onError={() => setBroken(true)} />
        ) : (
          <span aria-hidden="true">{initials(funnel.speaker_name).toUpperCase()}</span>
        )}
      </div>
      <div className="speaker__text">
        <div className="speaker__name">{funnel.speaker_name}</div>
        {funnel.speaker_title && <div className="speaker__title">{funnel.speaker_title}</div>}
      </div>
    </div>
  );
}
