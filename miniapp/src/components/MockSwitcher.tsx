/** Faqat mock rejim: holatlar orasida almashish (pastki chap burchak). */
import { useState } from 'react';
import { getMockScenario, MOCK_SCENARIOS, setMockScenario } from '../api/mock';

export default function MockSwitcher({ onSwitch }: { onSwitch(): void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(getMockScenario);
  return (
    <div className="mock-switch">
      {open && (
        <div className="mock-switch__panel">
          <label htmlFor="mock-select">Mock holat</label>
          <select
            id="mock-select"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setMockScenario(e.target.value);
              onSwitch();
            }}
          >
            {MOCK_SCENARIOS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        className="mock-switch__toggle"
        aria-label="Mock holat almashtirgich"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        M
      </button>
    </div>
  );
}
