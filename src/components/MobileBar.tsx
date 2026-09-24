// The control bar on a phone. The desktop bar holds every setting in one strip; here a compact
// top bar names the city and the session, the settings open in a sheet, and the screens move to
// a tab bar at the bottom. The controls themselves are the desktop's, so they behave the same.
import { useState } from 'react'
import { hasPreference } from '../lib/prefs'
import { barText } from '../lib/bar'
import { CityList } from './CityPicker'
import {
  BandControl,
  BasisControl,
  DewControl,
  DriveControl,
  LookbackControl,
  MoreControls,
  PresetItems,
  StrictControl,
  Tabs,
  UnitsControl,
  type BarProps,
  type Menu,
} from './ControlBar'
import { Sheet } from './Sheet'

type Open = 'city' | 'settings' | 'presets' | null

export function MobileBar(props: BarProps) {
  const { prefs: p, set, u, city } = props
  const [open, setOpen] = useState<Open>(null)
  // Only the custom-window picker opens inside the settings sheet.
  const [menu, setMenu] = useState<Menu>(null)
  const toggle = (m: Menu) => setMenu((cur) => (cur === m ? null : m))
  const close = () => {
    setOpen(null)
    setMenu(null)
  }
  const { summary, warmNote } = barText(p, u, city, props.warmMonths)
  const scored = hasPreference(p)

  return (
    <>
      <header className="m-bar">
        <div className="m-nav">
          <span className={scored ? 'brand-mark' : 'brand-mark off'} />
          <button className="m-city" onClick={() => setOpen('city')} aria-label={`City: ${city.name}. Change city`}>
            <span className="m-city-name">
              {city.name}, {city.code}
            </span>
            <span className="caret">▾</span>
          </button>
          <button className="btn" onClick={() => setOpen('settings')}>
            Settings
          </button>
        </div>
        <button className="m-summary" onClick={() => setOpen('settings')} aria-label="Edit settings">
          <span className="summary-text">{summary}</span>
          <span className="cap" style={{ color: 'var(--accent)' }}>
            EDIT
          </span>
        </button>
        {!scored && (
          <div className="m-prompt">
            State a comfort band, or{' '}
            <button className="inline-link" onClick={() => setOpen('presets')}>
              pick a starting point
            </button>
            , and every day in the record is scored against it.
          </div>
        )}
      </header>

      <div className="m-tabbar">
        <Tabs view={props.view} setView={props.setView} cmpCount={props.cmpCount} />
      </div>

      <Sheet open={open === 'city'} title="City" onClose={close} tall>
        <CityList
          current={city.id}
          autoFocus={false}
          onPick={(id) => {
            props.setCity(id)
            close()
          }}
          note={(c) => (props.comfByCity[c.id] != null ? `comf ${props.comfByCity[c.id]}` : null)}
        />
      </Sheet>

      <Sheet open={open === 'presets'} title="Starting points" onClose={close}>
        <div className="m-list">
          <PresetItems set={set} u={u} done={close} />
        </div>
      </Sheet>

      <Sheet open={open === 'settings'} title="Settings" onClose={close} tall>
        <div className="m-groups">
          <div className="m-group">
            <button className="btn m-wide" onClick={() => setOpen('presets')}>
              Start from a preset ▸
            </button>
          </div>
          <div className="m-group">
            <BandControl p={p} set={set} u={u} />
          </div>
          <div className="m-group">
            <DewControl p={p} set={set} u={u} />
          </div>
          <div className="m-group">
            <StrictControl p={p} set={set} />
          </div>
          <div className="m-group">
            <DriveControl p={p} set={set} />
          </div>
          <div className="m-group">
            <LookbackControl p={p} set={set} menu={menu} toggle={toggle} />
          </div>
          <div className="m-group">
            <BasisControl p={p} set={set} />
          </div>
          <div className="m-group">
            <span className="cap">UNITS</span>
            <UnitsControl p={p} set={set} />
          </div>
          <div className="m-group m-more">
            <span className="h-sm">MORE CONTROLS</span>
            <MoreControls
              p={p}
              set={set}
              u={u}
              warmNote={warmNote}
              calFill={props.calFill}
              setCalFill={props.setCalFill}
              reset={props.reset}
              done={close}
            />
          </div>
        </div>
      </Sheet>
    </>
  )
}
