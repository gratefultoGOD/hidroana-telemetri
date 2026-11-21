import { formatTestDuration, testFileUrl, testRequest } from './test-api.mjs'
import { element, fillSelect, labeledField, openTestDialog } from './test-dialogs.mjs'

const FILTERS = [
  ['year', 'Yıl'], ['vehicleName', 'Araç'], ['motor', 'Motor'],
  ['powerSource', 'Güç kaynağı'], ['purpose', 'Test amacı'], ['track', 'Pist']
]

const dateTime = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium'
})
const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 4 })
const order = new Intl.Collator('tr')
const lower = text => text.toLocaleLowerCase('tr-TR')

export function groupTestRecords(files) {
  const years = new Map()
  for (const file of files) {
    if (!years.has(file.year)) years.set(file.year, [])
    years.get(file.year).push(file)
  }
  return years
}

export function mountTestFilters(container, onFilter) {
  let files = []
  const search = element('input')
  search.type = 'search'
  const searchField = labeledField('Test adı veya pilot', search)
  searchField.classList.add('test-filter-search')
  const controls = FILTERS.map(([key, label]) => {
    const select = element('select')
    return { key, select, field: labeledField(label, select) }
  })
  const clear = element('button', 'Filtreleri temizle', 'test-ui-button test-filter-clear')
  clear.type = 'button'

  function filter() {
    const query = lower(search.value.trim())
    const selected = controls.filter(({ select }) => select.value)
    clear.disabled = !query && !selected.length
    const matching = files.filter(file =>
      selected.every(({ key, select }) => String(file[key]) === select.value) &&
      (!query || lower(`${file.fileName} ${file.pilotName ?? ''}`).includes(query)))
    onFilter(matching, files.length)
  }

  search.addEventListener('input', filter)
  for (const { select } of controls) select.addEventListener('change', filter)
  clear.addEventListener('click', () => {
    search.value = ''
    for (const { select } of controls) select.value = ''
    filter()
  })
  container.replaceChildren(searchField, ...controls.map(({ field }) => field), clear)
  return nextFiles => {
    files = nextFiles
    for (const { key, select } of controls) {
      const options = Array.from(new Set(files.map(file => file[key]).filter(Boolean).map(String)))
      options.sort(key === 'year' ? (a, b) => Number(b) - Number(a) : order.compare)
      fillSelect(select, options, 'Tümü')
    }
    filter()
  }
}

function fileDetails(file) {
  const started = file.startTime ? dateTime.format(new Date(file.startTime)) : [file.date, file.time].filter(Boolean).join(' ')
  const weight = kg => kg == null ? null : `${numberFormat.format(kg)} kg`
  const size = file.fileSize < 1024 ? `${file.fileSize} B` : `${numberFormat.format(file.fileSize / 1024)} KB`
  const details = element('details', null, 'test-card__details')
  const fields = element('dl', null, 'test-details-grid')
  const entries = [
    ['Arşiv yılı', file.year], ['Başlangıç', started], ['Araç', file.vehicleName], ['Motor', file.motor],
    ['Güç kaynağı', file.powerSource], ['Test amacı', file.purpose], ['Pist', file.track],
    ['Araç kilosu', weight(file.vehicleWeightKg)], ['Pilot', file.pilotName], ['Pilot kilosu', weight(file.pilotWeightKg)],
    ['Bitiş', file.endTime && dateTime.format(new Date(file.endTime))],
    ['Test süresi', file.durationMs == null ? null : formatTestDuration(file.durationMs, true)], ['Dosya boyutu', size]
  ]
  for (const [label, value] of entries) {
    const field = element('div')
    field.append(element('dt', label), element('dd', value || '—'))
    fields.append(field)
  }
  details.append(element('summary', 'Ayrıntılar'), fields)
  const notes = element('div', null, 'test-card__notes')
  for (const [label, value] of [['Test öncesi not', file.beforeNotes], ['Test sonrası not', file.afterNotes]]) {
    const note = element('section')
    note.append(element('h4', label), element('p', value || '—'))
    notes.append(note)
  }
  const pauses = element('section', null, 'test-card__pauses')
  pauses.append(element('h4', 'Duraklamalar'))
  if (file.pauses?.length) {
    const list = element('ul')
    for (const pause of file.pauses) {
      const row = element('li')
      const times = `${dateTime.format(new Date(pause.startTime))} → ${dateTime.format(new Date(pause.endTime))}`
      row.append(element('p', `${times} · ${formatTestDuration(pause.durationMs, true)}`, 'test-ui-muted'),
        element('p', pause.note || '—'))
      list.append(row)
    }
    pauses.append(list)
  } else {
    pauses.append(element('p', '—'))
  }
  details.append(notes, pauses)
  return details
}

function recordCard(file, rename, remove) {
  const title = file.fileName.replace(/\.csv$/, '')
  const card = element('article', null, 'test-card')
  const info = [file.vehicleName, file.powerSource, file.purpose, file.track, `${file.dataCount} telemetri kaydı`].filter(Boolean)
  const actions = element('div', null, 'test-card__actions')
  for (const [label, action] of [['CSV', 'download'], ['Excel', 'download-xlsx']]) {
    const link = element('a', label, 'test-ui-button')
    link.href = testFileUrl(action, file)
    actions.append(link)
  }
  for (const [label, action] of [['Yeniden adlandır', () => rename(file, title)], ['Sil', () => remove(file, title)]]) {
    const button = element('button', label, 'test-ui-button')
    button.type = 'button'
    button.addEventListener('click', action)
    actions.append(button)
  }
  actions.lastElementChild.classList.add('test-ui-button--danger')
  card.append(element('h4', title), element('p', info.join(' · '), 'test-ui-muted'), actions, fileDetails(file))
  return card
}

export function openTestRecords() {
  const { body, dialog } = openTestDialog('Test kayıtları', 'test-dialog--records')
  const filters = element('div', null, 'test-filters')
  const message = element('p', null, 'test-ui-muted')
  message.setAttribute('role', 'status')
  const list = element('div', null, 'test-record-list')
  body.append(filters, message, list)

  async function load() {
    message.textContent = 'Yükleniyor…'
    try {
      const { files } = await testRequest('/api/test/files')
      if (!dialog.open) return
      filters.hidden = !files.length
      setFiles(files)
    } catch (error) {
      message.textContent = error.message
    }
  }

  async function rename(file, title) {
    const newName = window.prompt('Yeni dosya adı', title)?.trim()
    if (!newName || newName === title) return
    try {
      await testRequest(testFileUrl('rename', file), 'PATCH', { newName })
      await load()
    } catch (error) {
      message.textContent = error.message
    }
  }

  async function remove(file, title) {
    if (!window.confirm(`“${title}” silinsin mi?`)) return
    try {
      await testRequest(testFileUrl('delete', file), 'DELETE')
      await load()
    } catch (error) {
      message.textContent = error.message
    }
  }

  const setFiles = mountTestFilters(filters, (files, total) => {
    message.textContent = files.length ? '' : total ? 'Filtrelere uyan test bulunamadı.' : 'Henüz test kaydı yok.'
    list.replaceChildren()
    for (const [year, group] of groupTestRecords(files)) {
      const section = element('section', null, 'test-record-year')
      section.append(element('h3', year))
      for (const file of group) section.append(recordCard(file, rename, remove))
      list.append(section)
    }
  })
  filters.hidden = true
  void load()
}
