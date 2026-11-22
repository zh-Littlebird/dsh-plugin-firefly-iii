/**
 * Firefly III — Settings section (Web half).
 *
 * Registers one page in the Settings panel ("Firefly III"), where the five
 * `autoCreate` switches can be flipped without hand-editing YAML. Values are
 * read from and written to this package's Host half:
 *
 *   GET  /firefly-iii-ui/settings   effective Config snapshot
 *   PUT  /firefly-iii-ui/settings   persists through the Host configEditor
 *   POST /firefly-iii-ui/test       checks the token against the instance
 *
 * The token value itself never reaches this page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-firefly-iii',
  factory(require) {
    'use strict'
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/firefly-iii-ui'
    const AUTO_KEYS = ['accounts', 'categories', 'tags', 'budgets', 'piggyBanks']
    const FONT =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
    const MONO = 'ui-monospace, SFMono-Regular, Consolas, "Cascadia Mono", "Liberation Mono", monospace'

    let currentLang = 'zh'

    const COPY = {
      zh: {
        title: 'Firefly III',
        subtitle: '记账插件的自动创建开关与连接状态；保存后写入本机 profile 配置并立即生效。',
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
        connectionHint: '令牌只存放在本机凭据库，不会显示在此页面；用 /firefly-token <token> 保存。',
        baseUrl: '实例地址',
        currency: '默认币种',
        timeZone: '时区',
        token: '访问令牌',
        tokenOn: '已配置',
        tokenOff: '未配置',
        tokenFromCredentials: '来自凭据库',
        tokenFromEnvironment: '来自环境变量',
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
        editorOff: '当前组合没有挂载配置编辑器，开关只能查看，不能保存。手动编辑 profile 的 cordis.patch.yml 可改默认值。',
        restartHint: '配置已写入，但插件尚未切换到新值：重启 DSH 后生效。',
        saveFailed: '保存失败',
      },
      en: {
        title: 'Firefly III',
        subtitle: 'Auto-create switches and connection facts for the bookkeeping plugin. Saving writes the local profile config and applies it immediately.',
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
        connectionHint: 'The token stays in the local credential store and is never shown here. Save one with /firefly-token <token>.',
        baseUrl: 'Instance URL',
        currency: 'Default currency',
        timeZone: 'Time zone',
        token: 'Access token',
        tokenOn: 'Configured',
        tokenOff: 'Not configured',
        tokenFromCredentials: 'from credentials',
        tokenFromEnvironment: 'from environment',
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
        editorOff: 'This composition has no config editor, so the switches are read-only. Edit the profile cordis.patch.yml to change defaults.',
        restartHint: 'Configuration was written but the plugin has not switched yet: restart DSH to apply it.',
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
      '.ff3-facts { display: grid; grid-template-columns: minmax(110px, max-content) minmax(0, 1fr); gap: 8px 16px; padding: 12px 16px 14px; border-top: 1px solid var(--dsw-alias-border-l1); }',
      '.ff3-fact-label { font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-secondary); }',
      '.ff3-fact-value { font-size: 12px; line-height: 17px; word-break: break-all; }',
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
        setDraft(next && next.autoCreate ? { ...next.autoCreate } : null)
      }, [])

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const response = await fetch(ENDPOINT + '/settings', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          applyView(await readJson(response, copy.endpointMissing))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setLoading(false)
        }
      }, [copy])

      React.useEffect(() => {
        load()
      }, [load])

      const dirty =
        view && draft && AUTO_KEYS.some((key) => draft[key] !== !!(view.autoCreate && view.autoCreate[key]))

      function toggle(key) {
        if (!draft) return
        setNotice(null)
        setDraft({ ...draft, [key]: !draft[key] })
      }

      async function waitForApplied(target) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 300))
          try {
            const response = await fetch(ENDPOINT + '/settings', {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            const next = await readJson(response, copy.endpointMissing)
            const matched = AUTO_KEYS.every((key) => !!next.autoCreate[key] === target[key])
            if (matched) {
              applyView(next)
              return true
            }
          } catch (error) {
            // The endpoint disappears briefly while the plugin restarts.
          }
        }
        return false
      }

      async function save() {
        if (!draft) return
        setSaving(true)
        setNotice(null)
        const target = {}
        for (const key of AUTO_KEYS) target[key] = !!draft[key]
        try {
          const response = await fetch(ENDPOINT + '/settings', {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              'x-firefly-iii-ui': '1',
            },
            body: JSON.stringify({ autoCreate: target }),
          })
          await readJson(response, copy.endpointMissing)
          const applied = await waitForApplied(target)
          setNotice(applied ? { tone: 'success', text: copy.saved } : { tone: 'warn', text: copy.restartHint })
          if (!applied) {
            setDraft({ ...target })
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

      async function test() {
        setTesting(true)
        setTestResult(null)
        try {
          const response = await fetch(ENDPOINT + '/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: '{}',
          })
          setTestResult(await readJson(response, copy.endpointMissing))
        } catch (failure) {
          setTestResult({ ok: false, message: failure instanceof Error ? failure.message : String(failure) })
        } finally {
          setTesting(false)
        }
      }

      const header = h(
        'div',
        { className: 'ff3-head', key: 'head' },
        h('div', { className: 'ff3-title' }, copy.title),
        h('div', { className: 'ff3-sub' }, copy.subtitle),
      )

      if (loading) {
        return h('div', { className: 'ff3-root' }, h('style', { key: 'css' }, CSS), header, h('div', { className: 'ff3-loading' }, copy.loading))
      }

      if (error !== null) {
        return h(
          'div',
          { className: 'ff3-root' },
          h('style', { key: 'css' }, CSS),
          header,
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
            checked: draft ? !!draft[key] : false,
            disabled: !editable || saving || dirty === undefined,
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

      const testLine = testResult
        ? h(
            'div',
            {
              className:
                'ff3-notice ' + (testResult.ok ? 'ff3-notice-success' : 'ff3-notice-error'),
              style: { marginTop: 0 },
            },
            testResult.ok
              ? copy.testOk +
                ' · Firefly III ' +
                String(testResult.version || '?') +
                ' (API ' +
                String(testResult.apiVersion || '?') +
                ')' +
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
          { className: 'ff3-facts' },
          h('div', { className: 'ff3-fact-label' }, copy.baseUrl),
          h('div', { className: 'ff3-fact-value ff3-mono' }, String(connection.baseUrl || '—')),
          h('div', { className: 'ff3-fact-label' }, copy.currency),
          h('div', { className: 'ff3-fact-value' }, String(connection.currency || '—')),
          h('div', { className: 'ff3-fact-label' }, copy.timeZone),
          h('div', { className: 'ff3-fact-value' }, String(connection.timeZone || '—')),
          h('div', { className: 'ff3-fact-label' }, copy.token),
          h(
            'div',
            { className: 'ff3-fact-value' },
            h(
              'span',
              { className: 'ff3-token-line' },
              h('span', { className: 'ff3-dot' + (token.configured ? ' ff3-dot-on' : '') }),
              h('span', {}, tokenLabel),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ff3-btn',
                  style: { height: 26, padding: '0 10px', fontSize: 11.5 },
                  disabled: testing || !token.configured,
                  onClick: test,
                },
                testing ? copy.testing : copy.test,
              ),
            ),
          ),
        ),
        testLine ? h('div', { style: { padding: '0 16px 14px' } }, testLine) : null,
      )

      const banner = editable
        ? null
        : h('div', { className: 'ff3-notice ff3-notice-warn' }, view && view.reason ? view.reason || copy.editorOff : copy.editorOff)

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
              disabled: !editable || !dirty || saving,
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
        header,
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
