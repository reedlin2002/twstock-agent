/* 檢查表列（趨勢結構 / 進場訊號） */
import { Check } from 'lucide-react';

const Yes = () => <span className="yes"><Check size={12} />符合</span>;
const No = () => <span className="no">未到位</span>;

export const Rows = ({ items }) => items.map(([tx, ok], i) => (
  <div className="rw" key={i}><span className="tx">{tx}</span>{ok ? <Yes /> : <No />}</div>
));
