import { testRequest } from './test-api.mjs'

let dialogId = 0
let fieldId = 0

export function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text != null) node.textContent = text
  if (className) node.className = className
  return node
}

export function openTestDialog(title, className = '') {
  const dialog = element('dialog', null, `test-dialog ${className}`.trim())
  const heading = element('h2', title)
  heading.id = `test-dialog-title-${++dialogId}`
  dialog.setAttribute('aria-labelledby', heading.id)

  const close = element('button', '×', 'test-dialog__close')
  close.type = 'button'
  close.setAttribute('aria-label', 'Kapat')
  close.addEventListener('click', () => dialog.close())
  const header = element('header', null, 'test-dialog__header')
  header.append(heading, close)
  const body = element('div', null, 'test-dialog__body')
  dialog.append(header, body)
  document.body.append(dialog)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  dialog.addEventListener('cancel', event => { if (close.disabled) event.preventDefault() })
  dialog.showModal()
  return { dialog, body, close }
}

export function labeledField(label, control) {
  const field = element('div', null, 'test-field')
  const caption = element('label', label)
  control.id = `test-field-${++fieldId}`
  caption.htmlFor = control.id
  field.append(caption, control)
  return field
}

export function fillSelect(select, items, placeholder, selected = select.value) {
  select.replaceChildren(new Option(placeholder, ''))
  for (const item of items) {
    const option = typeof item === 'string' ? { label: item, value: item } : item
    select.add(new Option(option.label, option.value))
  }
  select.value = Array.from(select.options).some(option => option.value === selected) ? selected : ''
}

function formControl(tag, name, attributes = {}) {
  return Object.assign(element(tag), { name, ...attributes })
}

function submitForm({ dialog, body, close }, form, { submitLabel, cancelLabel, onSubmit }) {
  const error = element('p', null, 'test-ui-error')
  error.setAttribute('role', 'alert')
  error.hidden = true
  const actions = element('div', null, 'test-dialog__actions')
  const cancel = element('button', cancelLabel, 'test-ui-button')
  cancel.type = 'button'
  cancel.addEventListener('click', () => dialog.close())
  const submit = element('button', submitLabel, 'test-ui-button test-ui-button--primary')
  submit.type = 'submit'
  actions.append(cancel, submit)
  form.append(error, actions)
  body.replaceChildren(form)

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (submit.disabled) return
    error.hidden = true
    submit.disabled = cancel.disabled = close.disabled = true
    try {
      await onSubmit(Object.fromEntries(new FormData(form)))
      dialog.close()
    } catch (failure) {
      error.textContent = failure.message
      error.hidden = false
      error.scrollIntoView({ block: 'nearest' })
    } finally {
      submit.disabled = cancel.disabled = close.disabled = false
    }
  })
}

export async function openTestStartDialog(defaultVehicle, onStart) {
  const modal = openTestDialog('Testi başlat')
  modal.body.append(element('p', 'Yükleniyor…', 'test-ui-muted'))
  try {
    const options = await testRequest('/api/test/options')
    if (!modal.dialog.open) return

    const form = element('form')
    const fields = element('div', null, 'test-fields')
    const vehicle = formControl('select', 'vehicle', { required: true })
    const motor = formControl('select', 'motor', { required: true })
    const powerSource = formControl('select', 'powerSource', { required: true })
    const purpose = formControl('select', 'purpose', { required: true })
    const track = formControl('select', 'track', { required: true })
    const pilotName = formControl('input', 'pilotName', { required: true, maxLength: options.maxPilotNameLength })
    const weightOptions = { type: 'number', min: '0.01', step: 'any', inputMode: 'decimal', required: true }
    const vehicleWeight = formControl('input', 'vehicleWeightKg', weightOptions)
    const pilotWeight = formControl('input', 'pilotWeightKg', weightOptions)
    const beforeNotes = formControl('textarea', 'beforeNotes', { rows: 3, maxLength: options.maxNoteLength })

    fillSelect(vehicle, options.vehicles, 'Araç seçin', defaultVehicle)
    fillSelect(motor, options.motors, 'Motor seçin')
    fillSelect(powerSource, options.powerSources, 'Güç kaynağı seçin')
    fillSelect(track, options.tracks, 'Pist seçin')
    const updatePurposes = () => fillSelect(purpose,
      options.purposes.filter(option => !option.motor || option.motor === motor.value), 'Amaç seçin')
    motor.addEventListener('change', updatePurposes)
    updatePurposes()

    fields.append(labeledField('Araç', vehicle), labeledField('Motor', motor),
      labeledField('Güç kaynağı', powerSource), labeledField('Test amacı', purpose),
      labeledField('Pist', track), labeledField('Pilotun adı', pilotName),
      labeledField('Araç kilosu (kg)', vehicleWeight), labeledField('Pilot kilosu (kg)', pilotWeight))
    form.append(fields, labeledField('Test öncesi not (isteğe bağlı)', beforeNotes))
    submitForm(modal, form, { submitLabel: 'Testi başlat', cancelLabel: 'Vazgeç', onSubmit: onStart })
    vehicle.focus()
  } catch (error) {
    modal.body.replaceChildren(element('p', error.message, 'test-ui-error'))
  }
}

export function openTestNoteDialog({ title, label, value = '', summary, cancelLabel = 'Atla', onSave }) {
  const modal = openTestDialog(title)
  const form = element('form')
  if (summary) form.append(element('p', summary, 'test-ui-muted'))
  const note = formControl('textarea', 'note', { rows: 4, value })
  form.append(labeledField(label, note))
  submitForm(modal, form, { submitLabel: 'Notu kaydet', cancelLabel, onSubmit: ({ note }) => onSave(note) })
  note.focus()
}
