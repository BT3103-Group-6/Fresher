// NFR-05: run the real VerifyView script and template with Vue's in-memory renderer.
// Inject rejected confirmBooking calls at the Firebase boundary: this tests what the UI shows
// after a simulated failed write, not Firestore rollback or the live network.
// No emulator or new dependency needed: Vue includes its SFC compiler.
// Run: node --test --test-reporter=tap tests/nfr05.failure.test.mjs
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'

const filename = 'src/views/customer/VerifyView.vue'
const source = readFileSync(new URL('../src/views/customer/VerifyView.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source, { filename })
assert.deepEqual(errors, [])
const compiled = compileScript(descriptor, {
  id: 'nfr05-verify-test', inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
// Supply dependencies to the compiled SFC without changing its handlers or template.
const executable = compiled.content.replace(
  /import\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2\s*;?/g,
  (_, names, quote, module) => `const { ${names.replace(/\bas\b/g, ':')} } = dependencies[${JSON.stringify(module)}];`,
).replace(/export default/, 'return')
assert.doesNotMatch(executable, /^\s*import\s/m, 'every SFC import must be explicitly supplied')
const componentOf = new Function('dependencies', 'navigator', 'window', 'document', executable)

// Only host operations are fake; Vue still renders the real conditional branches and handlers.
const hostNode = (type, text = '') => ({
  type, text, children: [], props: {}, parent: null, value: '', tagName: type.toUpperCase(),
  addEventListener() {}, removeEventListener() {}, focus() {}, getRootNode: () => fakeDocument,
})
function remove(node) {
  if (!node.parent) return
  const siblings = node.parent.children
  const index = siblings.indexOf(node)
  if (index >= 0) siblings.splice(index, 1)
  node.parent = null
}
const renderer = Vue.createRenderer({
  createElement: (tag) => hostNode(tag),
  createText: (text) => hostNode('#text', text),
  createComment: (text) => hostNode('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText(node, text) {
    for (const child of node.children) child.parent = null
    node.children = []
    node.text = text
  },
  patchProp: (node, key, previous, value) => { node.props[key] = value },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor = null) {
    remove(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove,
})
const fakeDocument = { activeElement: null, querySelector: () => null }
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
function textOf(node) {
  if (!node || node.type === '#comment') return ''
  return node.text + node.children.map(textOf).join('')
}

async function openConfirmation(endpoint) {
  const requestId = 'nfr05-failure-request-0001'
  const draft = Vue.reactive({
    shopId: 'test-shop', serviceId: 'cut', name: 'Test User', phone: '90000001',
    hold: {
      requestId, barberId: 'b1', start: Date.now() + 86400e3,
      holdExpiresAt: Date.now() + 600e3, durationMin: 30, priceCents: 2500,
    },
  })
  const calls = []
  const routes = []
  let otpCalls = 0
  const dependencies = {
    vue: Vue,
    'vue-router': { useRouter: () => ({ replace: async (route) => { routes.push(route) } }) },
    'firebase/firestore': {
      doc: () => ({}),
      getDoc: async () => ({ data: () => ({ name: 'Test shop', displayName: 'Test barber', noticeMins: 120 }) }),
    },
    'firebase/functions': {
      httpsCallable: (functions, name) => {
        if (name === 'releaseHold') return async () => ({ data: { released: true } })
        assert.equal(name, 'confirmBooking')
        return async (data) => { calls.push({ ...data }); return endpoint(data) }
      },
    },
    '@/firebase': { db: {}, functions: {} },
    '@/lib/slots': { formatDate: () => 'Test date', formatTime: () => '10:00' },
    '@/lib/customerAuth': {
      normalizeSgMobile: (phone) => '+65' + phone,
      otpErrorMessage: (error) => error.message,
      sendOtp: async () => {},
      verifyOtp: async () => { otpCalls++ },
      signedInAs: () => null,
    },
    '@/stores/booking': { draft, newAttempt: () => { draft.hold = null } },
  }
  const component = componentOf(dependencies, { onLine: true }, {
    addEventListener() {}, removeEventListener() {},
  }, fakeDocument)
  const app = renderer.createApp(component)
  app.component('router-link', { setup: (_, { slots }) => () => Vue.h('a', slots.default?.()) })
  const root = hostNode('root')
  const unhandled = []
  app.config.errorHandler = (error) => { unhandled.push(error) }
  app.mount(root)
  const byId = (id) => find(root, (node) => node.props.id === id)
  const form = (id) => find(root, (node) => node.type === 'form' && node.props['aria-labelledby'] === id)
  const submit = (node) => {
    assert.ok(node, 'form is rendered')
    return node.props.onSubmit({ preventDefault() {} })
  }
  try {
    await Vue.nextTick()
    await submit(form('details-h'))
    await Vue.nextTick()
    assert.ok(byId('code'), 'OTP step is rendered')
    // A browser sets the input's value before firing its model update.
    byId('code').value = '123456'
    byId('code').props['onUpdate:modelValue']('123456')
    await Vue.nextTick()
    return {
      root, draft, calls, routes, unhandled, requestId, app,
      otpCalls: () => otpCalls,
      submit: () => submit(form('code-h')),
      confirmed: () => !!find(root, (node) => node.type === 'h1' && textOf(node) === 'Booking confirmed'),
      button: () => find(form('code-h'), (node) => node.type === 'button' && node.props.type === 'submit'),
      alert: () => find(root, (node) => node.props.role === 'alert'),
    }
  } catch (error) {
    app.unmount()
    throw error
  }
}
const failureCodes = ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded', 'functions/resource-exhausted']
const writeFailure = (code) => Object.assign(new Error('Simulated booking-write failure'), { code })
const success = (data) => ({ data: {
  ...data, status: 'CONFIRMED', start: Date.now() + 86400e3, durationMin: 30, priceCents: 2500,
} })

it('100 simulated failed booking writes: zero success screens; error shown, form retained and retry enabled', async (t) => {
  let attempted = 0
  let falselyConfirmed = 0
  for (let i = 0; i < 100; i++) {
    let rejectWrite
    const page = await openConfirmation(() => {
      attempted++
      return new Promise((resolve, reject) => { rejectWrite = reject })
    })
    try {
      const submission = page.submit()
      await Vue.nextTick()
      assert.equal(typeof rejectWrite, 'function', 'the booking callable was reached after OTP')
      assert.equal(page.button().props.disabled, true, 'submit disabled while write is pending')
      assert.equal(page.confirmed(), false, 'no optimistic confirmation before write resolves')
      rejectWrite(writeFailure(failureCodes[i % failureCodes.length]))
      await submission
      await Vue.nextTick()
      if (page.confirmed()) falselyConfirmed++
      assert.equal(page.confirmed(), false, `failure ${i + 1} must not show success`)
      assert.match(textOf(page.alert()), /Could not confirm your booking/)
      assert.equal(page.draft.name, 'Test User')
      assert.equal(page.draft.phone, '90000001')
      assert.equal(page.draft.hold.requestId, page.requestId)
      assert.equal(page.button().props.disabled, false, 'retry enabled')
      assert.equal(page.otpCalls(), 1)
      assert.equal(page.calls.length, 1)
      assert.deepEqual(page.routes, [], 'no success/deposit navigation')
      assert.deepEqual(page.unhandled, [])
    } finally {
      page.app.unmount()
    }
  }
  assert.equal(attempted, 100)
  assert.equal(falselyConfirmed, 0)
  t.diagnostic(`Simulated rejected booking writes: ${attempted}; falsely shown as success: ${falselyConfirmed}. Four error codes, 25 cases each.`)
})

it('positive control: a successful write renders Booking confirmed', async () => {
  const page = await openConfirmation(async (data) => success(data))
  try {
    await page.submit()
    await Vue.nextTick()
    assert.equal(page.confirmed(), true)
    assert.equal(page.alert(), null)
    assert.equal(page.calls.length, 1)
    assert.deepEqual(page.unhandled, [])
  } finally { page.app.unmount() }
})

it('retry after a failed write reuses the request ID and verified OTP, then shows a genuine success', async () => {
  let count = 0
  const page = await openConfirmation(async (data) => {
    if (++count === 1) throw writeFailure('functions/unavailable')
    return success(data)
  })
  try {
    await page.submit()
    await Vue.nextTick()
    assert.equal(page.confirmed(), false)
    assert.ok(page.alert())
    await page.submit()
    await Vue.nextTick()
    assert.equal(page.confirmed(), true)
    assert.equal(page.alert(), null)
    assert.equal(page.otpCalls(), 1, 'a recoverable write failure does not require a new OTP')
    assert.equal(page.calls.length, 2)
    assert.deepEqual(page.calls[0], page.calls[1])
    assert.deepEqual(page.unhandled, [])
  } finally { page.app.unmount() }
})
