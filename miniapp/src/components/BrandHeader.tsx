import { useState } from 'react';
import type { FunnelBrand } from '../api/types';
import { MicMark } from './Decor';

/** Logotip + kurs nomi + webinar nomi (kutish va boshqa ekranlar tepasida). */
export function BrandHeader({ funnel }: { funnel: FunnelBrand }) {
  const [broken, setBroken] = useState(false);
  const logo = funnel.logo_url && !broken ? funnel.logo_url : null;
  return (
    <header className="brand">
      <div className="brand__logo">
        {logo ? <img src={logo} alt="" onError={() => setBroken(true)} /> : <MicMark size={22} />}
      </div>
      <div className="brand__text">
        <div className="brand__course">{funnel.course_title}</div>
        <div className="brand__webinar">{funnel.webinar_title}</div>
      </div>
    </header>
  );
}
