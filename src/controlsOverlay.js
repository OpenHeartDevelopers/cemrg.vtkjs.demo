/**
 * controlsOverlay.js
 *
 * Injects a persistent 2D HUD panel into the page describing all available
 * controls for both desktop (mouse) and VR (headset + controllers) modes,
 * plus the pulse animation toggle.
 *
 * Design decisions:
 *   - Pure DOM/CSS: no canvas, no VTK 2D actor. VTK 2D actors live inside
 *     the WebGL context and are clipped when entering XR. A DOM overlay
 *     persists correctly across XR session transitions.
 *   - Collapsible: the panel can be minimised to a tab so it does not
 *     obscure the mesh during demos.
 *   - Stateless module: call createControlsOverlay() once at startup.
 *     Call setOverlayMode('vr') / setOverlayMode('desktop') to switch the
 *     active hint section when the XR session starts/ends.
 *
 * Usage (from index.js):
 *   import { createControlsOverlay, setOverlayMode } from './controlsOverlay.js';
 *
 *   createControlsOverlay();                    // once at startup
 *   XRHelper.startXR(...).then(() => {
 *       setOverlayMode('vr');
 *   });
 *   XRHelper.stopXR().then(() => {
 *       setOverlayMode('desktop');
 *   });
 */

// ---------------------------------------------------------------------------
// Copy definitions
// ---------------------------------------------------------------------------

const DESKTOP_CONTROLS = [
    { key: 'Left drag', action: 'Rotate model' },
    { key: 'Right drag', action: 'Pan view' },
    { key: 'Scroll', action: 'Zoom in / out' },
    { key: 'Mesh selector', action: 'Switch heart condition' },
    { key: 'Representation', action: 'Points / Wireframe / Surface' },
    { key: 'Opacity slider', action: 'Adjust transparency' },
    { key: 'Start Pulse', action: 'Animate heartbeat (~72bpm)' },
];

const VR_CONTROLS = [
    { key: 'Right trigger + move', action: 'Rotate model' },
    { key: 'Right thumbstick', action: 'Scale model up/down' },
    { key: 'Look around', action: 'Inspect freely (seated)' },
    { key: 'Return From VR button', action: 'Exit VR session' },
];

const PULSE_INFO =
    'Heartbeat animation oscillates the mesh at ~72 bpm (1.2 Hz), ' +
    '\u00b14% scale. Paused automatically on VR entry.';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
  #cemrg-overlay {
    position: fixed;
    bottom: 18px;
    right: 18px;
    width: 290px;
    background: rgba(8, 12, 20, 0.88);
    border: 1px solid rgba(80, 160, 220, 0.35);
    border-radius: 6px;
    font-family: 'JetBrains Mono', 'Fira Mono', 'Consolas', monospace;
    font-size: 11px;
    color: #c8d8e8;
    z-index: 9999;
    backdrop-filter: blur(6px);
    user-select: none;
    box-shadow: 0 4px 24px rgba(0,0,0,0.55);
    transition: opacity 0.2s ease;
  }

  #cemrg-overlay-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(80, 160, 220, 0.2);
    cursor: pointer;
  }

  #cemrg-overlay-title {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(100, 180, 240, 0.9);
    font-weight: 600;
  }

  #cemrg-overlay-toggle {
    font-size: 13px;
    color: rgba(100, 180, 240, 0.6);
    line-height: 1;
  }

  #cemrg-overlay-body {
    padding: 10px 12px 12px;
    overflow: hidden;
  }

  #cemrg-overlay-body.collapsed {
    display: none;
  }

  .cemrg-section-label {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(100, 180, 240, 0.5);
    margin: 10px 0 5px;
    border-bottom: 1px solid rgba(80, 160, 220, 0.15);
    padding-bottom: 3px;
  }

  .cemrg-section-label:first-child {
    margin-top: 0;
  }

  .cemrg-control-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 2px 0;
    gap: 8px;
  }

  .cemrg-key {
    color: rgba(200, 230, 255, 0.75);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cemrg-action {
    color: rgba(160, 200, 220, 0.6);
    text-align: right;
    font-size: 10px;
  }

  .cemrg-mode-section {
    transition: opacity 0.25s ease;
  }

  .cemrg-mode-section.inactive {
    opacity: 0.3;
  }

  .cemrg-mode-badge {
    display: inline-block;
    font-size: 8px;
    letter-spacing: 0.1em;
    padding: 1px 5px;
    border-radius: 3px;
    margin-left: 6px;
    vertical-align: middle;
    text-transform: uppercase;
  }

  .cemrg-mode-badge.active-desktop {
    background: rgba(60, 160, 100, 0.25);
    color: rgba(100, 210, 140, 0.9);
    border: 1px solid rgba(60, 160, 100, 0.4);
  }

  .cemrg-mode-badge.active-vr {
    background: rgba(60, 100, 200, 0.25);
    color: rgba(100, 160, 255, 0.9);
    border: 1px solid rgba(60, 100, 200, 0.4);
  }

  .cemrg-mode-badge.inactive-badge {
    display: none;
  }

  .cemrg-pulse-info {
    font-size: 10px;
    color: rgba(140, 190, 210, 0.5);
    line-height: 1.45;
    margin-top: 4px;
  }
`;

// ---------------------------------------------------------------------------
// DOM construction helpers
// ---------------------------------------------------------------------------

/**
 * Builds a section of control rows.
 * @param {string}                          labelText
 * @param {Array<{key: string, action: string}>} rows
 * @param {string}                          sectionId    DOM id for the wrapper
 * @param {string}                          badgeText    e.g. 'Active' or 'VR'
 * @param {string}                          badgeClass
 * @returns {HTMLElement}
 */
function buildSection(labelText, rows, sectionId, badgeText, badgeClass) {
    const section = document.createElement('div');
    section.className = 'cemrg-mode-section';
    section.id = sectionId;

    const label = document.createElement('div');
    label.className = 'cemrg-section-label';
    label.textContent = labelText;

    const badge = document.createElement('span');
    badge.className = `cemrg-mode-badge ${badgeClass}`;
    badge.textContent = badgeText;
    label.appendChild(badge);

    section.appendChild(label);

    rows.forEach(({ key, action }) => {
        const row = document.createElement('div');
        row.className = 'cemrg-control-row';

        const keyEl = document.createElement('span');
        keyEl.className = 'cemrg-key';
        keyEl.textContent = key;

        const actEl = document.createElement('span');
        actEl.className = 'cemrg-action';
        actEl.textContent = action;

        row.appendChild(keyEl);
        row.appendChild(actEl);
        section.appendChild(row);
    });

    return section;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** @type {'desktop'|'vr'} */
let currentMode = 'desktop';

/**
 * Switches the active hint section between desktop and VR.
 * Call this from index.js when XR session starts or ends.
 * @param {'desktop'|'vr'} mode
 */
export function setOverlayMode(mode) {
    currentMode = mode;

    const desktopSection = document.getElementById('cemrg-section-desktop');
    const vrSection = document.getElementById('cemrg-section-vr');
    const desktopBadge = document.getElementById('cemrg-badge-desktop');
    const vrBadge = document.getElementById('cemrg-badge-vr');

    if (!desktopSection || !vrSection) return;

    if (mode === 'vr') {
        desktopSection.classList.add('inactive');
        vrSection.classList.remove('inactive');
        if (desktopBadge) desktopBadge.className = 'cemrg-mode-badge inactive-badge';
        if (vrBadge) vrBadge.className = 'cemrg-mode-badge active-vr';
    } else {
        vrSection.classList.add('inactive');
        desktopSection.classList.remove('inactive');
        if (vrBadge) vrBadge.className = 'cemrg-mode-badge inactive-badge';
        if (desktopBadge) desktopBadge.className = 'cemrg-mode-badge active-desktop';
    }
}

/**
 * Creates and injects the controls overlay into the page.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function createControlsOverlay() {
    // Idempotency guard
    if (document.getElementById('cemrg-overlay')) return;

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    // Root panel
    const panel = document.createElement('div');
    panel.id = 'cemrg-overlay';

    // Header (click to collapse)
    const header = document.createElement('div');
    header.id = 'cemrg-overlay-header';
    header.innerHTML = `
        <span id="cemrg-overlay-title">Controls</span>
        <span id="cemrg-overlay-toggle">&#8211;</span>
    `;
    panel.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.id = 'cemrg-overlay-body';

    // Desktop section
    const desktopSection = buildSection(
        'Desktop / Mouse',
        DESKTOP_CONTROLS,
        'cemrg-section-desktop',
        'Active',
        'active-desktop',
    );
    // Expose badge id for setOverlayMode()
    desktopSection.querySelector('.cemrg-mode-badge').id = 'cemrg-badge-desktop';
    body.appendChild(desktopSection);

    // VR section (dimmed until XR session starts)
    const vrSection = buildSection(
        'VR Headset',
        VR_CONTROLS,
        'cemrg-section-vr',
        'VR',
        'inactive-badge',
    );
    vrSection.classList.add('inactive');
    vrSection.querySelector('.cemrg-mode-badge').id = 'cemrg-badge-vr';
    body.appendChild(vrSection);

    // Pulse info
    const pulseLabel = document.createElement('div');
    pulseLabel.className = 'cemrg-section-label';
    pulseLabel.textContent = 'Pulse Animation';

    const pulseText = document.createElement('div');
    pulseText.className = 'cemrg-pulse-info';
    pulseText.textContent = PULSE_INFO;

    body.appendChild(pulseLabel);
    body.appendChild(pulseText);

    panel.appendChild(body);
    document.body.appendChild(panel);

    // Collapse / expand toggle
    let expanded = true;
    header.addEventListener('click', () => {
        expanded = !expanded;
        body.classList.toggle('collapsed', !expanded);
        document.getElementById('cemrg-overlay-toggle').textContent = expanded ? '\u2013' : '+';
    });
}