/**
 * Firefly III — Settings section (Web half).
 *
 * Registers one page in the Settings panel ("Firefly III"), where the instance
 * URL, the personal access token and the five `autoCreate` switches can be set
 * without hand-editing YAML. Values are read from and written to this
 * package's Host half:
 *
 *   GET  /firefly-iii-ui/settings   effective Config snapshot
 *   PUT  /firefly-iii-ui/settings   persists through the Host configEditor
 *                                   (switches, baseUrl) and credentials (token)
 *   POST /firefly-iii-ui/test       checks a token against an instance, using
 *                                   unsaved draft values when supplied
 *
 * The token value never reaches this page again after saving: the endpoint
 * only never returns it, so the field always starts empty.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-firefly-iii',
  factory(require) {
    'use strict'
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/firefly-iii-ui'
    const AUTO_KEYS = ['accounts', 'categories', 'tags', 'budgets', 'piggyBanks']
    const TOKEN_MIN_LENGTH = 20
    const FONT =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
    const MONO = 'ui-monospace, SFMono-Regular, Consolas, "Cascadia Mono", "Liberation Mono", monospace'

    let currentLang = 'zh'

    const COPY = {
      zh: {
        title: 'Firefly III',
        subtitle: '在这里填写实例地址与访问令牌，并调整自动创建开关；保存后写入本机 profile 配置并立即生效。',
        autoTitle: '自动创建（autoCreate）',
        autoHint: '开启后，工具遇到不存在的对象会隐式创建；关闭时只接受 firefly_lookup 返回的真实 ID 或名称，不会猜测。',
        rows: {
          accounts: { title: '账户', desc: '交易或显式创建时，自动新建未知账户' },
          categories: { title: '分类', desc: '允许未知分类名被隐式创建' },
          tags: { title: '标签', desc: '允许未知标签名被隐式创建' },
          budgets: { title: '预算', desc: '允许未知预算名与预算额度被创建' },
          piggyBanks: { title: '存钱罐', desc: '允许通过工具创建存钱罐' },
        },
        connectionTitle: '连接与凭据',
        connectionHint: '带 * 的两项可以在此填写；地址写入本机 profile 配置，令牌写入本机凭据库且不会再次显示。',
        baseUrl: '实例地址',
        baseUrlHint: '以 https:// 开头；本机地址可以用 http。粘贴以 /api 或 /api/v1 结尾的地址会自动去掉。',
        baseUrlPlaceholder: 'https://firefly.example.com/',
        invalidBaseUrl: '实例地址必须是以 http(s) 开头的完整 URL。',
        httpLocalOnly: '只有本机地址（localhost / 127.0.0.1）可以使用 http。',
        token: '访问令牌',
        tokenHint:
          '在 Firefly III 的 Profile → OAuth → Personal Access Tokens 里创建。令牌只保存在本机凭据库，保存后不会显示；留空表示不修改。',
        tokenPlaceholderEmpty: '粘贴个人访问令牌（JWT）',
        tokenPlaceholderStored: '已保存 · 留空表示不修改',
        tokenTooShort: '令牌太短；Firefly III 的令牌是长 JWT 字符串，请确认复制完整。',
        tokenOn: '已配置',
        tokenOff: '未配置',
        tokenFromCredentials: '来自凭据库',
        tokenFromEnvironment: '来自环境变量',
        tokenUnwritable: '凭据服务不可用，无法在此保存令牌。',
        tokenEnvOnly: '当前令牌来自环境变量 FIREFLY_III_ACCESS_TOKEN，页面无法清除。',
        clearToken: '清除令牌',
        undoClear: '撤销清除',
        clearPending: '保存后会删除已存储的令牌。',
        currency: '默认币种',
        timeZone: '时区',
        test: '测试连接',
        testing: '测试中…',
        testOk: '连接正常',
        testFail: '连接失败',
        save: '保存',
        saving: '保存中…',
        discard: '放弃改动',
        saved: '已保存并生效',
        unchanged: '没有改动',
        unsaved: '有未保存的改动',
        loading: '正在读取设置…',
        loadError: '读取设置失败',
        retry: '重试',
        endpointMissing: '设置端点未就绪：重启 DSH 后此页面才能读写配置。',
        editorOff: '当前组合没有挂载配置编辑器，地址与开关只能查看；令牌仍可保存。手动编辑 profile 的 cordis.patch.yml 可改地址。',
        restartHint: '配置已写入，但插件尚未切换到新值：稍等片刻仍不生效时请重启 DSH。',
        saveFailed: '保存失败',
      },
      en: {
        title: 'Firefly III',
        subtitle: 'Set the instance URL and access token here, and tune the auto-create switches. Saving writes the local profile config and applies it immediately.',
        autoTitle: 'Auto-create (autoCreate)',
        autoHint: 'When on, tools may create missing objects implicitly. When off, tools accept only ids or names returned by firefly_lookup and never guess.',
        rows: {
          accounts: { title: 'Accounts', desc: 'Create unknown accounts during transactions or explicit creates' },
          categories: { title: 'Categories', desc: 'Allow unknown category names to be created implicitly' },
          tags: { title: 'Tags', desc: 'Allow unknown tag names to be created implicitly' },
          budgets: { title: 'Budgets', desc: 'Allow unknown budget names and budget limits to be created' },
          piggyBanks: { title: 'Piggy banks', desc: 'Allow tools to create piggy banks' },
        },
        connectionTitle: 'Connection and credentials',
        connectionHint: 'The two starred fields are editable. The URL is saved to the local profile config; the token goes to the local credential store and is never shown again.',
        baseUrl: 'Instance URL',
        baseUrlHint: 'Start with https://; plain http is allowed for local addresses. A pasted trailing /api or /api/v1 is stripped.',
        baseUrlPlaceholder: 'https://firefly.example.com/',
        invalidBaseUrl: 'The instance URL must be a complete http(s) URL.',
        httpLocalOnly: 'Only local addresses (localhost / 127.0.0.1) may use plain http.',
        token: 'Access token',
        tokenHint:
          'Create one under Profile → OAuth → Personal Access Tokens in Firefly III. The token stays in the local credential store and is never shown after saving; leave the field empty to keep it.',
        tokenPlaceholderEmpty: 'Paste a personal access token (JWT)',
        tokenPlaceholderStored: 'Saved · leave empty to keep',
        tokenTooShort: 'The token looks too short; Firefly III tokens are long JWT strings.',
        tokenOn: 'Configured',
        tokenOff: 'Not configured',
        tokenFromCredentials: 'from credentials',
        tokenFromEnvironment: 'from environment',
        tokenUnwritable: 'The credential service is unavailable, so the token cannot be saved here.',
        tokenEnvOnly: 'The current token comes from FIREFLY_III_ACCESS_TOKEN and cannot be cleared here.',
        clearToken: 'Clear token',
        undoClear: 'Undo',
        clearPending: 'Saving will delete the stored token.',
        currency: 'Default currency',
        timeZone: 'Time zone',
        test: 'Test connection',
        testing: 'Testing…',
        testOk: 'Connected',
        testFail: 'Connection failed',
        save: 'Save',
        saving: 'Saving…',
        discard: 'Discard changes',
        saved: 'Saved and applied',
        unchanged: 'No changes',
        unsaved: 'Unsaved changes',
        loading: 'Loading settings…',
        loadError: 'Failed to load settings',
        retry: 'Retry',
        endpointMissing: 'Settings endpoint not ready: restart DSH to read and write configuration from this page.',
        editorOff: 'This composition has no config editor, so the URL and switches are read-only. The token can still be saved. Edit the profile cordis.patch.yml to change the URL.',
        restartHint: 'Configuration was written but the plugin has not switched yet: if it stays unchanged, restart DSH.',
        saveFailed: 'Save failed',
      },
    }

    const CSS = [
      '.ff3-root { font-family: ' + FONT + '; color: var(--dsw-alias-label-primary); max-width: 760px; padding: 2px 0 32px; }',
      '.ff3-head { margin-bottom: 18px; }',
      '.ff3-title { font-size: 16px; font-weight: 600; line-height: 24px; }',
      '.ff3-sub { margin-top: 4px; font-size: 12.5px; line-height: 19px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; overflow: hidden; }',
      '.ff3-card + .ff3-card { margin-top: 14px; }',
      '.ff3-card-head { padding: 14px 16px 11px; }',
      '.ff3-card-title { font-size: 13px; font-weight: 600; line-height: 19px; }',
      '.ff3-card-desc { margin-top: 3px; font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1); }',
      '.ff3-row-title { font-size: 12.5px; font-weight: 500; line-height: 18px; }',
      '.ff3-row-desc { margin-top: 2px; font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-switch { flex: none; position: relative; width: 34px; height: 20px; margin-top: 1px; padding: 0; border-radius: 999px;',
      '  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); cursor: pointer; transition: background .15s ease, border-color .15s ease; }',
      '.ff3-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;',
      '  background: var(--dsw-alias-bg-base); box-shadow: 0 1px 2px rgba(0,0,0,.18); transition: transform .15s ease; }',
      '.ff3-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }',
      '.ff3-switch[aria-checked="true"]::after { transform: translateX(14px); background: var(--dsw-alias-bg-base); }',
      '.ff3-switch:disabled { opacity: .5; cursor: default; }',
      '.ff3-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
      '.ff3-form { display: grid; grid-template-columns: minmax(96px, max-content) minmax(0, 1fr); gap: 12px 18px; padding: 14px 16px 16px; border-top: 1px solid var(--dsw-alias-border-l1); align-items: start; }',
      '.ff3-label { font-size: 11.5px; line-height: 30px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
      '.ff3-required { color: var(--dsw-alias-state-error-primary); margin-left: 2px; }',
      '.ff3-field { min-width: 0; }',
      '.ff3-field-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.ff3-input { width: 100%; height: 30px; padding: 0 9px; border-radius: 8px; box-sizing: border-box;',
      '  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);',
      '  font-family: inherit; font-size: 12px; }',
      '.ff3-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .75; }',
      '.ff3-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; border-color: transparent; }',
      '.ff3-input:disabled { opacity: .55; cursor: default; }',
      '.ff3-input-mono { font-family: ' + MONO + '; font-size: 11.5px; }',
      '.ff3-input-token { flex: 1 1 240px; width: auto; font-family: ' + MONO + '; }',
      '.ff3-field-hint { margin-top: 5px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-field-error { margin-top: 5px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-error-primary); }',
      '.ff3-fact { font-size: 12px; line-height: 30px; }',
      '.ff3-mono { font-family: ' + MONO + '; font-size: 11.5px; }',
      '.ff3-token-line { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.ff3-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }',
      '.ff3-dot-on { background: var(--dsw-alias-state-success-primary); }',
      '.ff3-hint { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
      '.ff3-btn { height: 30px; padding: 0 13px; border-radius: 8px; font-size: 12px; font-family: inherit; cursor: pointer;',
      '  border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }',
      '.ff3-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }',
      '.ff3-btn:disabled { opacity: .5; cursor: default; }',
      '.ff3-btn-primary { border-color: transparent; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }',
      '.ff3-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-label-primary); opacity: .88; }',
      '.ff3-notice { margin-top: 14px; padding: 9px 12px; border-radius: 9px; font-size: 12px; line-height: 18px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }',
      '.ff3-notice-success { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }',
      '.ff3-notice-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }',
      '.ff3-notice-error { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }',
      '.ff3-error { padding: 14px 16px; border-radius: 10px; border: 1px solid var(--dsw-alias-state-error-primary);',
      '  color: var(--dsw-alias-state-error-primary); font-size: 12.5px; line-height: 19px; }',
      '.ff3-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 16px; flex-wrap: wrap; }',
      '.ff3-footer-hint { font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-loading { font-size: 12.5px; color: var(--dsw-alias-label-secondary); padding: 10px 0; }',
    ].join('\n')

    const WRITE_HEADERS = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-firefly-iii-ui': '1',
    }

    function detectLang(ctx) {
      try {
        const service = ctx && ctx.get ? ctx.get('locale') : undefined
        const snapshot = service && service.getLocale ? service.getLocale() : null
        const raw = JSON.stringify(snapshot || {}).toLowerCase()
        if (raw.indexOf('zh') >= 0) return 'zh'
        if (raw.indexOf('en') >= 0) return 'en'
      } catch (error) {
        // No locale service: fall through to the default.
      }
      return 'zh'
    }

    function errorText(payload, fallback) {
      if (payload && payload.error && typeof payload.error.message === 'string') {
        return payload.error.hint ? payload.error.message + ' — ' + payload.error.hint : payload.error.message
      }
      return fallback
    }

    async function readJson(response, missingMessage) {
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (response.status === 404 && payload === null) {
        throw new Error(missingMessage)
      }
      if (!response.ok) {
        throw new Error(errorText(payload, 'HTTP ' + response.status))
      }
      return payload
    }

    /**
     * Read one settings payload. While the plugin restarts the SPA fallback can
     * answer a 200 with the page HTML, so a non-settings body is retried rather
     * than treated as state.
     */
    async function readSettings(response, missingMessage) {
      const payload = await readJson(response, missingMessage)
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        throw new Error(missingMessage)
      }
      return payload
    }

    /** Same rules as the Host validator, so the page can explain a typo early. */
    function baseUrlProblem(raw, copy) {
      const value = String(raw || '').trim()
      if (value === '') return null
      let url
      try {
        url = new URL(value)
      } catch (error) {
        return copy.invalidBaseUrl
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return copy.invalidBaseUrl
      const local = ['localhost', '127.0.0.1', '::1'].indexOf(url.hostname) >= 0
      if (url.protocol === 'http:' && !local) return copy.httpLocalOnly
      return null
    }

    function Switch(props) {
      const onChange = props.onChange
      return h('button', {
        type: 'button',
        className: 'ff3-switch',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: onChange,
      })
    }

    function FireflySettings() {
      const copy = COPY[currentLang]
      const [view, setView] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [testing, setTesting] = React.useState(false)
      const [testResult, setTestResult] = React.useState(null)

      const applyView = React.useCallback((next) => {
        setView(next)
        setDraft(
          next
            ? {
                autoCreate: { ...(next.autoCreate || {}) },
                baseUrl: String((next.connection && next.connection.baseUrl) || ''),
                token: '',
                clearToken: false,
              }
            : null,
        )
      }, [])

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const response = await fetch(ENDPOINT + '/settings', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          applyView(await readSettings(response, copy.endpointMissing))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setLoading(false)
        }
      }, [copy])

      React.useEffect(() => {
        load()
      }, [load])

      if (loading) {
        return h(
          'div',
          { className: 'ff3-root' },
          h('style', { key: 'css' }, CSS),
          h(
            'div',
            { className: 'ff3-head', key: 'head' },
            h('div', { className: 'ff3-title' }, copy.title),
            h('div', { className: 'ff3-sub' }, copy.subtitle),
          ),
          h('div', { className: 'ff3-loading' }, copy.loading),
        )
      }

      if (error !== null) {
        return h(
          'div',
          { className: 'ff3-root' },
          h('style', { key: 'css' }, CSS),
          h(
            'div',
            { className: 'ff3-head', key: 'head' },
            h('div', { className: 'ff3-title' }, copy.title),
            h('div', { className: 'ff3-sub' }, copy.subtitle),
          ),
          h(
            'div',
            { className: 'ff3-error' },
            h('div', {}, copy.loadError + ': ' + error),
            h(
              'div',
              { style: { marginTop: 10 } },
              h('button', { type: 'button', className: 'ff3-btn', onClick: load }, copy.retry),
            ),
          ),
        )
      }

      const editable = view && view.editable === true
      const token = (view && view.token) || {}
      const connection = (view && view.connection) || {}
      const tokenWritable = token.writable !== false
      const savedBaseUrl = String(connection.baseUrl || '')
      const configured = savedBaseUrl !== ''

      const draftState = draft || {
        autoCreate: { ...((view && view.autoCreate) || {}) },
        baseUrl: savedBaseUrl,
        token: '',
        clearToken: false,
      }
      const autoDirty = AUTO_KEYS.some(
        (key) => !!draftState.autoCreate[key] !== !!(view && view.autoCreate && view.autoCreate[key]),
      )
      const baseDirty = draftState.baseUrl.trim() !== savedBaseUrl
      const tokenDirty = draftState.token.trim() !== '' || draftState.clearToken
      const dirty = autoDirty || baseDirty || tokenDirty
      const needsConfigWrite = autoDirty || baseDirty
      const baseProblem = baseUrlProblem(draftState.baseUrl, copy)
      const tokenProblem =
        draftState.token.trim() !== '' && draftState.token.trim().length < TOKEN_MIN_LENGTH ? copy.tokenTooShort : null
      const invalid = baseProblem !== null || tokenProblem !== null
      const blocked = (needsConfigWrite && !editable) || (tokenDirty && !tokenWritable)
      const saveDisabled = !dirty || saving || invalid || blocked

      function setField(name, value) {
        setNotice(null)
        setTestResult(null)
        setDraft({ ...draftState, [name]: value })
      }

      function toggle(key) {
        if (!editable) return
        const next = { ...draftState.autoCreate, [key]: !draftState.autoCreate[key] }
        setNotice(null)
        setDraft({ ...draftState, autoCreate: next })
      }

      /** Poll the Host until the saved values are the effective ones. */
      async function waitForApplied(saved) {
        const expectedAuto = saved && saved.autoCreate
          ? { ...(view.autoCreate || {}), ...saved.autoCreate }
          : null
        const expectedBase = saved && typeof saved.baseUrl === 'string' ? saved.baseUrl : null
        const expectedToken = saved ? saved.token : null
        for (let attempt = 0; attempt < 14; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 350))
          try {
            const response = await fetch(ENDPOINT + '/settings', {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            const next = await readSettings(response, copy.endpointMissing)
            const autoOk =
              expectedAuto === null || AUTO_KEYS.every((key) => !!next.autoCreate[key] === !!expectedAuto[key])
            const baseOk = expectedBase === null || String((next.connection && next.connection.baseUrl) || '') === expectedBase
            const tokenOk =
              expectedToken === 'saved'
                ? !!(next.token && next.token.configured)
                : expectedToken === 'cleared'
                  ? !(next.token && next.token.stored)
                  : true
            if (autoOk && baseOk && tokenOk) return next
          } catch (failure) {
            // The settings route disappears briefly while the plugin restarts.
          }
        }
        return null
      }

      async function save() {
        if (saveDisabled) return
        setSaving(true)
        setNotice(null)
        const payload = {}
        if (autoDirty) {
          const changed = {}
          for (const key of AUTO_KEYS) {
            if (!!draftState.autoCreate[key] !== !!(view.autoCreate && view.autoCreate[key])) {
              changed[key] = !!draftState.autoCreate[key]
            }
          }
          payload.autoCreate = changed
        }
        if (baseDirty) payload.baseUrl = draftState.baseUrl.trim()
        if (draftState.clearToken) payload.clearToken = true
        else if (draftState.token.trim() !== '') payload.token = draftState.token.trim()
        try {
          const response = await fetch(ENDPOINT + '/settings', {
            method: 'PUT',
            headers: WRITE_HEADERS,
            body: JSON.stringify(payload),
          })
          const result = await readSettings(response, copy.endpointMissing)
          // The pasted secret is never kept in page state after a successful write.
          setDraft({ ...draftState, token: '', clearToken: false })
          const applied = await waitForApplied(result && result.saved ? result.saved : {})
          if (applied) {
            applyView(applied)
            setNotice({ tone: 'success', text: copy.saved })
          } else {
            setNotice({ tone: 'warn', text: copy.restartHint })
            load()
          }
        } catch (failure) {
          setNotice({
            tone: 'error',
            text: copy.saveFailed + ': ' + (failure instanceof Error ? failure.message : String(failure)),
          })
        } finally {
          setSaving(false)
        }
      }

      /** Test the values currently typed, so a token can be verified before saving. */
      async function test() {
        if (baseProblem !== null || tokenProblem !== null) {
          setTestResult({ ok: false, message: baseProblem || tokenProblem })
          return
        }
        setTesting(true)
        setTestResult(null)
        const body = {}
        if (draftState.baseUrl.trim() !== '') body.baseUrl = draftState.baseUrl.trim()
        if (draftState.token.trim() !== '') body.token = draftState.token.trim()
        try {
          const response = await fetch(ENDPOINT + '/test', {
            method: 'POST',
            headers: WRITE_HEADERS,
            body: JSON.stringify(body),
          })
          setTestResult(await readJson(response, copy.endpointMissing))
        } catch (failure) {
          setTestResult({ ok: false, message: failure instanceof Error ? failure.message : String(failure) })
        } finally {
          setTesting(false)
        }
      }

      const autoRows = AUTO_KEYS.map((key) => {
        const meta = copy.rows[key]
        return h(
          'div',
          { className: 'ff3-row', key },
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { className: 'ff3-row-title' }, meta.title),
            h('div', { className: 'ff3-row-desc' }, meta.desc),
          ),
          h(Switch, {
            checked: !!draftState.autoCreate[key],
            disabled: !editable || saving || testing,
            label: meta.title,
            onChange: () => toggle(key),
          }),
        )
      })

      const autoCard = h(
        'section',
        { className: 'ff3-card', key: 'auto' },
        h(
          'div',
          { className: 'ff3-card-head' },
          h('div', { className: 'ff3-card-title' }, copy.autoTitle),
          h('div', { className: 'ff3-card-desc' }, copy.autoHint),
        ),
        autoRows,
      )

      const tokenLabel = token.configured
        ? copy.tokenOn +
          (token.stored ? ' · ' + copy.tokenFromCredentials : token.environment ? ' · ' + copy.tokenFromEnvironment : '')
        : copy.tokenOff

      const tokenHint = !tokenWritable
        ? copy.tokenUnwritable
        : draftState.clearToken
          ? copy.clearPending
          : token.stored
            ? copy.tokenHint
            : token.environment
              ? copy.tokenEnvOnly
              : copy.tokenHint

      const tokenStatusLine = h(
        'div',
        { className: 'ff3-field-hint' },
        h(
          'span',
          { className: 'ff3-token-line' },
          h('span', { className: 'ff3-dot' + (token.configured ? ' ff3-dot-on' : '') }),
          h('span', {}, tokenLabel),
          token.stored && tokenWritable
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ff3-btn',
                  style: { height: 24, padding: '0 8px', fontSize: 11 },
                  disabled: saving || testing,
                  onClick: () => {
                    setNotice(null)
                    setTestResult(null)
                    setDraft({
                      ...draftState,
                      token: '',
                      clearToken: !draftState.clearToken,
                    })
                  },
                },
                draftState.clearToken ? copy.undoClear : copy.clearToken,
              )
            : null,
        ),
      )

      const testLine = testResult
        ? h(
            'div',
            {
              className: 'ff3-notice ' + (testResult.ok ? 'ff3-notice-success' : 'ff3-notice-error'),
              style: { marginTop: 0 },
            },
            testResult.ok
              ? copy.testOk +
                ' · Firefly III ' +
                String(testResult.version || '?') +
                ' (API ' +
                String(testResult.apiVersion || '?') +
                ')' +
                (testResult.baseUrl ? ' · ' + String(testResult.baseUrl) : '') +
                (testResult.hint ? ' — ' + testResult.hint : '')
              : copy.testFail + ' · ' + String(testResult.message || testResult.hint || ''),
          )
        : null

      const connectionCard = h(
        'section',
        { className: 'ff3-card', key: 'connection' },
        h(
          'div',
          { className: 'ff3-card-head' },
          h('div', { className: 'ff3-card-title' }, copy.connectionTitle),
          h('div', { className: 'ff3-card-desc' }, copy.connectionHint),
        ),
        h(
          'div',
          { className: 'ff3-form' },
          h(
            'label',
            { className: 'ff3-label', htmlFor: 'ff3-base-url' },
            copy.baseUrl,
            h('span', { className: 'ff3-required' }, '*'),
          ),
          h(
            'div',
            { className: 'ff3-field' },
            h('input', {
              id: 'ff3-base-url',
              type: 'url',
              className: 'ff3-input ff3-input-mono',
              value: draftState.baseUrl,
              placeholder: copy.baseUrlPlaceholder,
              disabled: !editable || saving || testing,
              spellCheck: false,
              autoComplete: 'off',
              'aria-invalid': baseProblem !== null ? 'true' : 'false',
              onChange: (event) => setField('baseUrl', event.target.value),
            }),
            baseProblem !== null
              ? h('div', { className: 'ff3-field-error' }, baseProblem)
              : h('div', { className: 'ff3-field-hint' }, copy.baseUrlHint),
          ),

          h(
            'label',
            { className: 'ff3-label', htmlFor: 'ff3-token' },
            copy.token,
            h('span', { className: 'ff3-required' }, '*'),
          ),
          h(
            'div',
            { className: 'ff3-field' },
            h(
              'div',
              { className: 'ff3-field-line' },
              h('input', {
                id: 'ff3-token',
                type: 'password',
                className: 'ff3-input ff3-input-token',
                value: draftState.token,
                placeholder: token.stored ? copy.tokenPlaceholderStored : copy.tokenPlaceholderEmpty,
                disabled: !tokenWritable || saving || testing || draftState.clearToken,
                spellCheck: false,
                autoComplete: 'new-password',
                'aria-invalid': tokenProblem !== null ? 'true' : 'false',
                onChange: (event) => setField('token', event.target.value),
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ff3-btn',
                  style: { height: 30, padding: '0 11px', fontSize: 11.5, flex: 'none' },
                  disabled: testing || saving || draftState.clearToken || (configured === false && draftState.baseUrl.trim() === ''),
                  onClick: test,
                },
                testing ? copy.testing : copy.test,
              ),
            ),
            tokenProblem !== null ? h('div', { className: 'ff3-field-error' }, tokenProblem) : null,
            tokenStatusLine,
            h('div', { className: 'ff3-field-hint' }, tokenHint),
          ),

          h('div', { className: 'ff3-label' }, copy.currency),
          h('div', { className: 'ff3-fact' }, String(connection.currency || '—')),

          h('div', { className: 'ff3-label' }, copy.timeZone),
          h('div', { className: 'ff3-fact' }, String(connection.timeZone || '—')),
        ),
        testLine ? h('div', { style: { padding: '0 16px 14px' } }, testLine) : null,
      )

      const banner = editable
        ? null
        : h('div', { className: 'ff3-notice ff3-notice-warn' }, (view && view.reason) || copy.editorOff)

      const footerHint = dirty ? copy.unsaved : copy.unchanged

      const footer = h(
        'div',
        { className: 'ff3-footer', key: 'footer' },
        h('div', { className: 'ff3-footer-hint' }, footerHint),
        h(
          'div',
          { className: 'ff3-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'ff3-btn',
              disabled: !dirty || saving,
              onClick: () => {
                setNotice(null)
                setTestResult(null)
                applyView(view)
              },
            },
            copy.discard,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ff3-btn ff3-btn-primary',
              disabled: saveDisabled,
              onClick: save,
            },
            saving ? copy.saving : copy.save,
          ),
        ),
      )

      const noticeLine = notice
        ? h(
            'div',
            {
              className:
                'ff3-notice ' +
                (notice.tone === 'success'
                  ? 'ff3-notice-success'
                  : notice.tone === 'warn'
                    ? 'ff3-notice-warn'
                    : 'ff3-notice-error'),
            },
            notice.text,
          )
        : null

      return h(
        'div',
        { className: 'ff3-root' },
        h('style', { key: 'css' }, CSS),
        h(
          'div',
          { className: 'ff3-head', key: 'head' },
          h('div', { className: 'ff3-title' }, copy.title),
          h('div', { className: 'ff3-sub' }, copy.subtitle),
        ),
        banner,
        autoCard,
        connectionCard,
        noticeLine,
        footer,
      )
    }

    function mount(ctx) {
      currentLang = detectLang(ctx)

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'firefly-iii',
            order: 18,
            label: 'Firefly III',
          },
          FireflySettings,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          mount(ctx)
        } catch (error) {
          try {
            window.console.error('[firefly-iii] Settings section failed to mount', error)
          } catch (ignored) {
            // Nothing else to do without a console.
          }
        }
      },
    }
  },
})
