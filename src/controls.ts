import { lightColor, normalizeHex } from './settings.ts';
import type { LightingScene } from './scene.ts';
import type { LightingSettings } from './settings.ts';
import { LIGHTING } from './config.ts';

export function createControls(container: HTMLElement, scene: LightingScene) {
  container.innerHTML = `
    <details class="control-panel" open>
      <summary>
        <span class="panel-heading"><span class="light-indicator" aria-hidden="true"></span>Lighting</span>
        <span class="panel-toggle" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="m4 6 4 4 4-4"/></svg></span>
      </summary>
      <form class="control-body" aria-label="Lighting controls">
        <div class="control-row">
          <div class="label-row"><label for="brightness">Brightness</label><output for="brightness" id="brightness-value"></output></div>
          <input id="brightness" type="range" min="${LIGHTING.brightness.min}" max="${LIGHTING.brightness.max}" step="${LIGHTING.brightness.step}" />
          <div class="range-ends" aria-hidden="true"><span>Off</span><span>${LIGHTING.brightness.max}%</span></div>
        </div>
        <fieldset class="mode-fieldset">
          <legend>Light color</legend>
          <div class="segmented">
            <label><input type="radio" name="light-mode" value="temperature" /><span>Temperature</span></label>
            <label><input type="radio" name="light-mode" value="custom" /><span>Custom</span></label>
          </div>
        </fieldset>
        <fieldset class="mode-controls" id="temperature-controls">
          <div class="label-row"><label for="temperature">Warmth</label><output for="temperature" id="temperature-value"></output></div>
          <input id="temperature" class="temperature-range" type="range" min="${LIGHTING.temperature.min}" max="${LIGHTING.temperature.max}" step="${LIGHTING.temperature.step}" />
          <div class="range-ends" aria-hidden="true"><span>Amber</span><span>Soft white</span></div>
        </fieldset>
        <fieldset class="mode-controls" id="custom-controls" hidden>
          <label class="color-label" for="light-hex">Custom light color</label>
          <div class="color-inputs">
            <input type="color" id="light-picker" aria-label="Choose light color" />
            <input type="text" id="light-hex" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="7" aria-describedby="light-error" />
            <span class="hex-hint" aria-hidden="true">HEX</span>
          </div>
          <p class="field-error" id="light-error" aria-live="polite" hidden>Enter a hex color, like #ffb36b.</p>
        </fieldset>
        <div class="control-row wall-control">
          <label class="color-label" for="wall-hex">Wall color</label>
          <div class="color-inputs">
            <input type="color" id="wall-picker" aria-label="Choose wall color" />
            <input type="text" id="wall-hex" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="7" aria-describedby="wall-error" />
            <span class="hex-hint" aria-hidden="true">HEX</span>
          </div>
          <p class="field-error" id="wall-error" aria-live="polite" hidden>Enter a hex color, like #303030.</p>
        </div>
        <div class="control-row distance-control">
          <div class="label-row"><label for="wall-distance">Distance from wall</label><output for="wall-distance" id="distance-value"></output></div>
          <input id="wall-distance" type="range" min="${LIGHTING.wallDistance.min}" max="${LIGHTING.wallDistance.max}" step="${LIGHTING.wallDistance.step}" />
          <div class="range-ends" aria-hidden="true"><span>Close</span><span>Far</span></div>
        </div>
        <div class="panel-footer"><span>Light & atmosphere</span><button type="button" id="reset">Reset lighting <span aria-hidden="true">↺</span></button></div>
      </form>
    </details>`;

  const events = new AbortController();
  const query = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;
  const input = (id: string) => query<HTMLInputElement>(`#${id}`);
  const brightness = input('brightness');
  const temperature = input('temperature');
  const distance = input('wall-distance');
  const modes = [...container.querySelectorAll<HTMLInputElement>('[name="light-mode"]')];
  const temperatureControls = query<HTMLFieldSetElement>('#temperature-controls');
  const customControls = query<HTMLFieldSetElement>('#custom-controls');

  function setRange(element: HTMLInputElement, value: number) {
    element.value = String(value);
    const fraction = (value - Number(element.min)) / (Number(element.max) - Number(element.min));
    element.style.setProperty('--progress', `${fraction * 100}%`);
  }

  function sync(settings: LightingSettings) {
    setRange(brightness, settings.brightness);
    setRange(temperature, settings.temperature);
    setRange(distance, settings.wallDistance);
    query<HTMLOutputElement>('#brightness-value').value = `${settings.brightness}%`;
    query<HTMLOutputElement>('#temperature-value').value = `${settings.temperature.toLocaleString()} K`;
    query<HTMLOutputElement>('#distance-value').value = `${Math.round(settings.wallDistance * 100)} cm`;
    brightness.setAttribute('aria-valuetext', `${settings.brightness} percent`);
    temperature.setAttribute('aria-valuetext', `${settings.temperature} kelvin`);
    distance.setAttribute('aria-valuetext', `${Math.round(settings.wallDistance * 100)} centimeters`);
    modes.forEach((mode) => { mode.checked = mode.value === settings.lightMode; });
    temperatureControls.hidden = settings.lightMode !== 'temperature';
    temperatureControls.disabled = temperatureControls.hidden;
    customControls.hidden = settings.lightMode !== 'custom';
    customControls.disabled = customControls.hidden;
    query<HTMLElement>('.light-indicator').style.backgroundColor = settings.brightness > 0 ? lightColor(settings) : '#62605c';
    for (const [prefix, color] of [['light', settings.customLightColor], ['wall', settings.wallColor]]) {
      input(`${prefix}-picker`).value = color;
      const hex = input(`${prefix}-hex`);
      // Don't replace partially typed or invalid text when another setting changes.
      if (document.activeElement !== hex && hex.getAttribute('aria-invalid') !== 'true') hex.value = color;
    }
  }

  function update(patch: Partial<LightingSettings>) {
    sync(scene.updateSettings(patch));
  }
  const listen = (element: Element, type: string, callback: EventListener) =>
    element.addEventListener(type, callback, { signal: events.signal });

  listen(query('form'), 'submit', (event) => event.preventDefault());
  listen(brightness, 'input', () => update({ brightness: brightness.valueAsNumber }));
  listen(temperature, 'input', () => update({ temperature: temperature.valueAsNumber }));
  listen(distance, 'input', () => update({ wallDistance: distance.valueAsNumber }));
  modes.forEach((mode) => listen(mode, 'change', () => {
    update({ lightMode: mode.value === 'custom' ? 'custom' : 'temperature' });
  }));

  function bindColor(prefix: 'light' | 'wall', key: 'customLightColor' | 'wallColor') {
    const picker = input(`${prefix}-picker`);
    const hex = input(`${prefix}-hex`);
    const error = query<HTMLElement>(`#${prefix}-error`);
    function validate() {
      const color = normalizeHex(hex.value);
      hex.setAttribute('aria-invalid', String(!color));
      error.hidden = !!color;
      if (color) update({ [key]: color });
      return color;
    }
    listen(picker, 'input', () => {
      hex.value = picker.value;
      hex.setAttribute('aria-invalid', 'false');
      error.hidden = true;
      update({ [key]: picker.value });
    });
    listen(hex, 'input', validate);
    listen(hex, 'change', () => {
      const color = validate();
      if (color) hex.value = color;
    });
  }
  bindColor('light', 'customLightColor');
  bindColor('wall', 'wallColor');
  listen(query('#reset'), 'click', () => {
    container.querySelectorAll('[aria-invalid]').forEach((element) => element.removeAttribute('aria-invalid'));
    container.querySelectorAll<HTMLElement>('.field-error').forEach((element) => { element.hidden = true; });
    sync(scene.reset());
  });
  sync(scene.settings);

  return {
    refresh(clearErrors = false) {
      if (clearErrors) {
        container.querySelectorAll('[aria-invalid]').forEach((element) => element.removeAttribute('aria-invalid'));
        container.querySelectorAll<HTMLElement>('.field-error').forEach((element) => { element.hidden = true; });
      }
      sync(scene.settings);
    },
    dispose() {
      events.abort();
      container.replaceChildren();
    },
  };
}
