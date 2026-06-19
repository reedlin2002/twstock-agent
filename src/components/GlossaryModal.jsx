/* 投資小辭典：右下浮動按鈕 + 底部彈窗 */
import { Bot, X } from 'lucide-react';
import { GLOSSARY } from '../data/constants.js';
import { useScrollLock } from '../lib/useScrollLock.js';

export default function GlossaryModal({ open, onOpen, onClose }) {
  useScrollLock(open);
  return (
    <>
      {/* 浮動按鈕：小管家 */}
      <div className="fab" onClick={onOpen} title="投資小辭典">
        <Bot className="fab-ico" size={26} />
      </div>

      {/* 補充資料彈窗 */}
      <div className={`glos-overlay ${open ? 'open' : ''}`} onClick={onClose}>
        <div className="glos-panel" onClick={e => e.stopPropagation()}>
          <div className="glos-hd">
            <div className="glos-tt"><Bot size={22} />投資小辭典</div>
            <button className="glos-cls" onClick={onClose}><X size={20} /></button>
          </div>
          <div className="glos-bd">
            {GLOSSARY.map(g => (
              <div key={g.category} className="glos-sec">
                <div className="glos-sh">{g.category}</div>
                {g.items.map(item => (
                  <div key={item.k} className="glos-item">
                    <div className="glos-k">{item.k}</div>
                    <div className="glos-v">{item.v}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
