/**
 * dsh-combinagents — Client half.
 *
 * One right-sidebar tab type plus a session-header utility. The tab is a
 * read/write editor over the Host bridge; it never touches a session header,
 * catalog, cwd, or policy. All visible copy comes from the `dsh-combinagents`
 * locale namespace.
 */

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-combinagents',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-combinagents'
    const TAB_ID = '@dsh-external/dsh-combinagents/composition'
    const KIND = 'dsh-combinagents'
    const PREFIX = '/dsh-combinagents'
    const TOKEN_HEADER = 'x-dsh-combinagents-token'
    const COMPOSITION_CHANGED = 'dsh-combinagents:composition-changed'

    const DICTS = {
      en: {
        'tab.title': 'Agent composition',
        'guide.title': 'Agent composition',
        'guide.description': 'Arrange who reports to whom in a user-owned overlay',
        'header.tooltip': 'Open agent composition',
        'editTitle': 'Edit title',
        'cloneTree': 'Clone whole tree',
        'cloneTreeConfirm': 'Clone the whole tree into new sessions? The source tree is not changed.',
        'cloneDone': 'Clone created: {session}',
        'bud': 'Bud as new root',
        'budConfirm': 'Clone this node and its subtree as a new independent root? The original stays in place.',
        'budDone': 'Bud created: {session}',
        'cloneBadge': 'clone',
        'cloneOf': 'Cloned from',
        'snapshotAt': 'Snapshot at',
        'notice': 'Composition edges are advisory. Native messaging, interruption, and Team authority still follow DSH\u2019s original subagent tree.',
        'loading': 'Loading composition\u2026',
        'empty': 'No composition yet for this session.',
        'create': 'Create composition',
        'add': 'Add',
        'addSession': 'Add a session',
        'searchPlaceholder': 'Filter by title, id, or workspace',
        'noSessions': 'No matching sessions.',
        'parent': 'Reports to',
        'noParent': 'No parent (root)',
        'remove': 'Remove',
        'removePrompt': 'Remove \u201c{label}\u201d from this composition?',
        'promote': 'Promote reports to roots',
        'cascade': 'Remove the whole subtree',
        'cancel': 'Cancel',
        'deleteComposition': 'Delete composition',
        'deleteConfirm': 'Delete this composition? Only the overlay is removed; no DSH session is deleted.',
        'confirmDelete': 'Delete',
        'storageMemory': 'Storage is unavailable; changes last only until the Host restarts.',
        'error': 'Something went wrong.',
        'retry': 'Retry',
        'source.top-level': 'top-level',
        'source.subagent': 'subagent',
        'source.external': 'external',
        'source.unknown': 'unknown',
        'live': 'live',
        'archived': 'archived',
        'saved': 'saved',
        'rootBadge': 'root session',
        'nodeCount': '{count} nodes',
        'details': 'Details',
        'hideDetails': 'Hide details',
        'save': 'Save',
        'rename': 'Rename',
        'reportsTo': 'Reports to',
        'openConversation': 'Open conversation',
        'externalAgents': 'External agents',
        'externalNote': 'External execution; cannot receive follow-ups.',
        'externalUnavailable': 'Native catalog unavailable.',
        'noExternal': 'No external agents found.',
        'sandbox': 'Sandbox',
        'preset': 'Permission preset',
        'nativeParent': 'Native parent',
        'agentPreset': 'Agent preset',
        'sessionId': 'Session id',
        'cwd': 'Workspace',
        'provider': 'Provider',
        'none': '\u2014',
        'agentBusy': 'An affected agent or one of its lineage is running; wait for it to finish.',
        'nativeMessagingNote': 'Messages follow the native subagent tree, not this composition edge.',
        'syncNative': 'Sync native agents',
        'grantMessage': 'Allow messages across this edge',
        'grantInterrupt': 'Allow parent to interrupt child',
        'tasks': 'Composition tasks',
        'taskSubject': 'Task',
        'taskDescription': 'Details',
        'taskOwner': 'Owner',
        'noTasks': 'No tasks yet.',
        'addTask': 'Add task',
        'taskStart': 'Start',
        'taskComplete': 'Complete',
        'taskReopen': 'Reopen',
        'taskDelete': 'Delete',
        'taskDeleteConfirm': 'Delete this task? It exists only in the plugin task board.',
        'statusPending': 'pending',
        'statusInProgress': 'in progress',
        'statusCompleted': 'completed',
        'unowned': 'unowned',
      },
      zh: {
        'tab.title': '代理组合',
        'guide.title': '代理组合',
        'guide.description': '在用户自有的叠加层中安排谁向谁汇报',
        'header.tooltip': '打开代理组合',
        'editTitle': '编辑标题',
        'cloneTree': '克隆整棵树',
        'cloneTreeConfirm': '把整棵树克隆成新的 Session 树？源树不会被修改。',
        'cloneDone': '克隆已创建：{session}',
        'bud': '出芽为根',
        'budConfirm': '把这个节点及其子树克隆为新的独立根？原节点保留在原树。',
        'budDone': '出芽已创建：{session}',
        'cloneBadge': '克隆',
        'cloneOf': '克隆来源',
        'snapshotAt': '快照时间',
        'notice': '组合边只是约定。原生消息、中断与 Team 权限仍按 DSH 原有的子代理树执行。',
        'loading': '正在加载组合\u2026',
        'empty': '这个会话还没有组合。',
        'create': '创建组合',
        'add': '添加',
        'addSession': '添加会话',
        'searchPlaceholder': '按标题、ID 或工作区过滤',
        'noSessions': '没有匹配的会话。',
        'parent': '汇报给',
        'noParent': '无上级（根节点）',
        'remove': '移除',
        'removePrompt': '从组合中移除“{label}”？',
        'promote': '下属提升为根',
        'cascade': '删除整棵子树',
        'cancel': '取消',
        'deleteComposition': '删除组合',
        'deleteConfirm': '删除这个组合？只删除叠加层，不会删除任何 DSH 会话。',
        'confirmDelete': '删除',
        'storageMemory': '存储不可用；改动只会保留到 Host 重启。',
        'error': '出错了。',
        'retry': '重试',
        'source.top-level': '顶层',
        'source.subagent': '子代理',
        'source.external': '外部',
        'source.unknown': '未知',
        'live': '活跃',
        'archived': '已归档',
        'saved': '已保存',
        'rootBadge': '根会话',
        'nodeCount': '{count} 个节点',
        'details': '详情',
        'hideDetails': '收起详情',
        'save': '保存',
        'rename': '重命名',
        'reportsTo': '汇报给',
        'openConversation': '打开会话',
        'externalAgents': '外部代理',
        'externalNote': '外部执行；无法接收后续消息。',
        'externalUnavailable': '原生 catalog 不可用。',
        'noExternal': '没有发现外部代理。',
        'sandbox': '沙箱',
        'preset': '权限预设',
        'nativeParent': '原生父节点',
        'agentPreset': '代理预设',
        'sessionId': '会话 ID',
        'cwd': '工作区',
        'provider': 'Provider',
        'none': '—',
        'agentBusy': '受影响代理或其父系正在工作；请等它完成后再编辑。',
        'nativeMessagingNote': '消息仍按原生子代理树传递，不经过这条组合边。',
        'syncNative': '同步原生子代理',
        'grantMessage': '允许该边双向消息',
        'grantInterrupt': '允许父节点中断子节点',
        'tasks': '组合任务板',
        'taskSubject': '任务',
        'taskDescription': '详情',
        'taskOwner': '负责人',
        'noTasks': '还没有任务。',
        'addTask': '添加任务',
        'taskStart': '开始',
        'taskComplete': '完成',
        'taskReopen': '重新打开',
        'taskDelete': '删除',
        'taskDeleteConfirm': '删除这个任务？它只存在于插件任务板，不是 DSH Team。',
        'statusPending': '待处理',
        'statusInProgress': '进行中',
        'statusCompleted': '已完成',
        'unowned': '未指派',
      },
    }

    const styles = {
      wrap: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: '1.45',
        minHeight: '100%',
        boxSizing: 'border-box',
      },
      header: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '14px', fontWeight: 600 },
      rootId: {
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'monospace',
        fontSize: '11px',
        overflowWrap: 'anywhere',
      },
      notice: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        borderRadius: '8px',
        padding: '8px 10px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      warning: {
        border: '1px solid var(--dsw-alias-state-warn-primary)',
        borderRadius: '8px',
        padding: '8px 10px',
        color: 'var(--dsw-alias-state-warn-primary)',
      },
      tree: { display: 'flex', flexDirection: 'column', gap: '4px' },
      row: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '6px',
        minHeight: '28px',
        padding: '2px 4px',
        borderRadius: '6px',
      },
      label: { fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' },
      badge: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        padding: '0 7px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      },
      detail: {
        marginLeft: '14px',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        overflowWrap: 'anywhere',
      },
      details: {
        margin: '4px 0 6px 14px',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      detailRow: {
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '12px',
        overflowWrap: 'anywhere',
      },
      detailLabel: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        minWidth: '92px',
      },
      sectionTitle: {
        marginTop: '8px',
        fontWeight: 600,
        fontSize: '12px',
      },
      button: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '6px',
        padding: '3px 9px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      danger: {
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        borderRadius: '6px',
        padding: '3px 9px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      linkButton: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-brand-primary)',
        padding: '2px 4px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      confirm: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        padding: '8px',
        margin: '4px 0 4px 14px',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      confirmRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      input: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '6px',
        padding: '3px 8px',
        fontSize: '12px',
        lineHeight: '18px',
        height: '28px',
        boxSizing: 'border-box',
        minWidth: 0,
        flex: '1 1 160px',
      },
      results: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        maxHeight: '40vh',
        overflowY: 'auto',
        paddingRight: '4px',
      },
      select: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '12px',
        maxWidth: '100%',
      },
      picker: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      sessionRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '3px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        contentVisibility: 'auto',
        containIntrinsicSize: '28px',
      },
      sessionTitle: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' },
      sessionMeta: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        flex: '0 1 auto',
        overflowWrap: 'anywhere',
      },
      board: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      taskForm: {
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap',
        alignItems: 'center',
      },
      taskRow: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        padding: '6px 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      error: {
        border: '1px solid var(--dsw-alias-state-error-primary)',
        borderRadius: '8px',
        padding: '8px 10px',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      iconButton: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        width: '24px',
        height: '24px',
        borderRadius: '6px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      headerChip: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        height: '24px',
        padding: '0 4px',
        borderRadius: '6px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
      },
    }

    let bootstrapPromise = null

    function getBootstrap() {
      if (bootstrapPromise === null) {
        bootstrapPromise = fetch(`${PREFIX}/bootstrap`, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`bootstrap failed: ${response.status}`)
            return response.json()
          })
          .catch((error) => {
            bootstrapPromise = null
            throw error
          })
      }
      return bootstrapPromise
    }

    /**
     * Call the bridge and retry once after a Host restart rotates the token.
     * @param {string} path - route after the prefix.
     * @param {{method?: string, body?: object}} [options] - request options.
     * @param {number} [attempt] - internal retry counter.
     * @returns {Promise<object>}
     */
    async function callApi(path, options = {}, attempt = 1) {
      const info = await getBootstrap()
      const headers = { accept: 'application/json', [TOKEN_HEADER]: info.token }
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      const response = await fetch(`${PREFIX}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      if (response.status === 401 && attempt === 1) {
        bootstrapPromise = null
        return callApi(path, options, 2)
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(data?.error?.message ?? `HTTP ${response.status}`)
        error.code = data?.error?.code ?? 'HTTP_ERROR'
        throw error
      }
      return data
    }

    /**
     * @param {(key: string) => string} t - bound translate.
     * @param {string} key - dictionary key.
     * @param {Record<string,string>} [values] - placeholders.
     * @returns {string}
     */
    function format(t, key, values) {
      const text = t(key)
      if (values === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
    }

    /**
     * @param {object} composition - validated graph.
     * @returns {{roots: object[], children: Map<string, object[]>}|null}
     */
    function treeOf(composition) {
      if (composition === null || composition === undefined) return null
      const byId = new Map(composition.nodes.map((node) => [node.id, node]))
      const children = new Map()
      const hasParent = new Set()
      for (const edge of composition.edges) {
        hasParent.add(edge.childId)
        const list = children.get(edge.parentId) ?? []
        list.push(byId.get(edge.childId))
        children.set(edge.parentId, list)
      }
      return {
        roots: composition.nodes.filter((node) => !hasParent.has(node.id)),
        children,
      }
    }

    function DetailRow(props) {
      const { label, value, t } = props
      return h('div', { style: styles.detailRow }, [
        h('span', { key: 'label', style: styles.detailLabel }, label),
        h('span', { key: 'value' }, value ?? t('none')),
      ])
    }

    function NodeDetails(props) {
      const {
        node, composition, observation, t, allNodes, busy, onRename, onReparent, onOpen,
        openAvailable, edge, grant, onGrant, onBud,
      } = props
      const [draft, setDraft] = React.useState(node.label)
      React.useEffect(() => { setDraft(node.label) }, [node.label])
      const parentId = composition.edges.find((edge) => edge.childId === node.id)?.parentId ?? ''
      const isExternal = node.kind === 'external'
      const rows = []
      if (isExternal) {
        rows.push(h(DetailRow, { key: 'provider', label: t('provider'), value: node.provider ?? t('none'), t }))
        rows.push(h(DetailRow, { key: 'parent', label: t('nativeParent'), value: node.nativeParentSessionId ?? t('none'), t }))
        rows.push(h('div', { key: 'external', style: styles.detailRow }, t('externalNote')))
        rows.push(h('div', {
          key: 'native-messaging',
          style: { ...styles.detailRow, color: 'var(--dsw-alias-label-secondary)' },
        }, t('nativeMessagingNote')))
      } else {
        rows.push(h(DetailRow, { key: 'id', label: t('sessionId'), value: node.sessionId, t }))
        rows.push(h(DetailRow, { key: 'cwd', label: t('cwd'), value: observation?.cwd ?? t('none'), t }))
        rows.push(h(DetailRow, {
          key: 'parent',
          label: t('nativeParent'),
          value: node.nativeParentSessionId ?? observation?.nativeParentSessionId ?? t('none'),
          t,
        }))
        rows.push(h(DetailRow, { key: 'sandbox', label: t('sandbox'), value: observation?.sandboxMode ?? t('none'), t }))
        rows.push(h(DetailRow, { key: 'preset', label: t('preset'), value: observation?.permissionPreset ?? t('none'), t }))
        rows.push(h(DetailRow, { key: 'agentPreset', label: t('agentPreset'), value: observation?.agentPreset ?? t('none'), t }))
        if (node.cloneOf) {
          rows.push(h(DetailRow, { key: 'cloneOf', label: t('cloneOf'), value: node.cloneOf, t }))
          rows.push(h(DetailRow, {
            key: 'snapshotAt',
            label: t('snapshotAt'),
            value: node.cloneSnapshotAt ? new Date(node.cloneSnapshotAt).toLocaleString() : t('none'),
            t,
          }))
        }
      }
      if (!isExternal && edge !== null && edge !== undefined) {
        rows.push(h('div', { key: 'grants', style: styles.detailRow }, [
          h('label', {
            key: 'message',
            style: { display: 'inline-flex', gap: '4px', alignItems: 'center' },
          }, [
            h('input', {
              key: 'checkbox',
              type: 'checkbox',
              checked: grant?.allowMessage === true,
              disabled: busy,
              onChange: (event) => onGrant(edge.id, { allowMessage: event.target.checked }),
            }),
            t('grantMessage'),
          ]),
          h('label', {
            key: 'interrupt',
            style: { display: 'inline-flex', gap: '4px', alignItems: 'center' },
          }, [
            h('input', {
              key: 'checkbox',
              type: 'checkbox',
              checked: grant?.allowInterrupt === true,
              disabled: busy,
              onChange: (event) => onGrant(edge.id, { allowInterrupt: event.target.checked }),
            }),
            t('grantInterrupt'),
          ]),
        ]))
      }
      rows.push(h('div', { key: 'rename', style: styles.detailRow }, [
        h('span', { key: 'label', style: styles.detailLabel }, t('rename')),
        h('input', {
          key: 'input',
          style: styles.input,
          value: draft,
          onChange: (event) => setDraft(event.target.value),
        }),
        h('button', {
          key: 'save',
          type: 'button',
          style: styles.button,
          disabled: busy || draft.trim().length === 0,
          onClick: () => onRename(node.id, draft),
        }, t('save')),
      ]))
      rows.push(h('div', { key: 'reparent', style: styles.detailRow }, [
        h('label', { key: 'label', style: styles.detailLabel }, t('reportsTo')),
        h('select', {
          key: 'select',
          style: styles.select,
          value: parentId,
          disabled: busy,
          onChange: (event) => onReparent(node.id, event.target.value.length > 0 ? event.target.value : null),
        }, [
          h('option', { key: 'root', value: '' }, t('noParent')),
          ...allNodes
            .filter((candidate) => candidate.id !== node.id)
            .map((candidate) => h('option', { key: candidate.id, value: candidate.id }, candidate.label)),
        ]),
      ]))
      if (!isExternal) {
        rows.push(h('button', {
          key: 'bud',
          type: 'button',
          style: styles.button,
          disabled: busy,
          onClick: () => onBud(node.id),
        }, t('bud')))
      }
      if (!isExternal && openAvailable) {
        rows.push(h('button', {
          key: 'open',
          type: 'button',
          style: styles.linkButton,
          onClick: () => onOpen(node.sessionId),
        }, t('openConversation')))
      }
      return h('div', { style: styles.details }, rows)
    }

    function NodeRow(props) {
      const {
        node, depth, tree, composition, observations, t, pendingRemove, setPendingRemove, busy,
        onRemove, expanded, onToggle, allNodes, onRename, onReparent, onOpen, openAvailable,
        grants, onGrant, onBud,
      } = props
      const observation = node.sessionId === null ? null : observations[node.sessionId] ?? null
      const incomingEdge = composition.edges.find((edge) => edge.childId === node.id) ?? null
      const isRoot = node.sessionId !== null && node.sessionId === composition.rootSessionId
      const isExpanded = expanded.includes(node.id)
      const children = tree.children.get(node.id) ?? []
      const rows = [
        h('div', { key: 'row', style: { ...styles.row, paddingLeft: `${4 + depth * 14}px` } }, [
          h('button', {
            key: 'toggle',
            type: 'button',
            style: styles.linkButton,
            'aria-expanded': isExpanded,
            onClick: () => onToggle(node.id),
          }, isExpanded ? t('hideDetails') : t('details')),
          node.kind === 'session' && openAvailable
            ? h('button', {
                key: 'open',
                type: 'button',
                style: styles.linkButton,
                onClick: () => onOpen(node.sessionId),
              }, t('openConversation'))
            : null,
          h('span', { key: 'label', style: styles.label }, node.label),
          h('span', { key: 'source', style: styles.badge }, t(`source.${node.source}`)),
          node.cloneOf ? h('span', { key: 'clone', style: styles.badge }, t('cloneBadge')) : null,
          observation === null
            ? null
            : h('span', { key: 'live', style: styles.badge },
                observation.archived ? t('archived') : observation.live ? t('live') : t('saved')),
          isRoot ? h('span', { key: 'root', style: styles.badge }, t('rootBadge')) : null,
          isRoot || busy
            ? null
            : h('button', {
                key: 'remove',
                type: 'button',
                style: styles.danger,
                onClick: () => setPendingRemove(node),
              }, t('remove')),
        ]),
      ]
      if (isExpanded) {
        rows.push(h(NodeDetails, {
          key: 'details',
          node,
          composition,
          observation,
          t,
          allNodes,
          busy,
          onRename,
          onReparent,
          onOpen,
          openAvailable,
          edge: incomingEdge,
          grant: incomingEdge === null ? null : grants[incomingEdge.id] ?? null,
          onGrant,
          onBud,
        }))
      }
      if (pendingRemove !== null && pendingRemove.id === node.id) {
        rows.push(h('div', { key: 'confirm', style: { ...styles.confirm, marginLeft: `${14 + depth * 14}px` } }, [
          h('div', { key: 'prompt' }, format(t, 'removePrompt', { label: node.label })),
          h('div', { key: 'actions', style: styles.confirmRow }, [
            h('button', {
              key: 'promote',
              type: 'button',
              style: styles.button,
              disabled: busy,
              onClick: () => onRemove('promote'),
            }, t('promote')),
            h('button', {
              key: 'cascade',
              type: 'button',
              style: styles.danger,
              disabled: busy,
              onClick: () => onRemove('cascade'),
            }, t('cascade')),
            h('button', {
              key: 'cancel',
              type: 'button',
              style: styles.linkButton,
              onClick: () => setPendingRemove(null),
            }, t('cancel')),
          ]),
        ]))
      }
      if (node.kind !== 'external' || isExpanded) {
        for (const child of children) {
          rows.push(h(NodeRow, {
            key: child.id,
            node: child,
            depth: depth + 1,
            tree,
            composition,
            observations,
            t,
            pendingRemove,
            setPendingRemove,
            busy,
            onRemove,
            expanded,
            onToggle,
            allNodes,
            onRename,
            onReparent,
            onOpen,
            openAvailable,
            grants,
            onGrant,
            onBud,
          }))
        }
      }
      return h('div', null, rows)
    }

    function SessionPicker(props) {
      const {
        sessions, query, setQuery, parentId, setParentId, nodes, busy, onAdd, t,
        external, externalAvailable, onAddExternal, titles, onNeedTitles,
      } = props
      const text = query.trim().toLowerCase()
      const labelOf = (session) => titles[session.sessionId] ?? session.title
      const visible = (text.length === 0
        ? sessions
        : sessions.filter((session) => `${labelOf(session)} ${session.sessionId} ${session.cwd ?? ''}`.toLowerCase().includes(text)))
        .slice(0, 200)
      const visibleKey = visible.slice(0, 20).map((session) => session.sessionId).join(',')
      React.useEffect(() => {
        if (visible.length > 0) onNeedTitles(visible.slice(0, 20).map((session) => session.sessionId))
      }, [visibleKey, onNeedTitles])
      return h('div', { style: styles.picker }, [
        h('div', { key: 'parent', style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, [
          h('label', { key: 'label', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' } }, t('parent')),
          h('select', {
            key: 'select',
            style: styles.select,
            value: parentId,
            onChange: (event) => setParentId(event.target.value),
          }, [
            h('option', { key: 'root', value: '' }, t('noParent')),
            ...nodes.map((node) => h('option', { key: node.id, value: node.id }, node.label)),
          ]),
        ]),
        h('input', {
          key: 'query',
          style: styles.input,
          value: query,
          placeholder: t('searchPlaceholder'),
          onChange: (event) => setQuery(event.target.value),
        }),
        h('div', { key: 'results', style: styles.results }, [
          ...visible.map((session) => h('div', { key: session.sessionId, style: styles.sessionRow }, [
            h('span', { key: 'title', style: styles.sessionTitle }, labelOf(session)),
            h('span', { key: 'meta', style: styles.sessionMeta }, session.cwd ?? session.sessionId),
            h('button', {
              key: 'add',
              type: 'button',
              style: styles.button,
              disabled: busy,
              onClick: () => onAdd(session),
            }, t('add')),
          ])),
          visible.length === 0 ? h('div', { key: 'none', style: styles.sessionMeta }, t('noSessions')) : null,
          h('div', { key: 'external-title', style: styles.sectionTitle }, t('externalAgents')),
          externalAvailable === false
            ? h('div', { key: 'external-unavailable', style: styles.sessionMeta }, t('externalUnavailable'))
            : external.length === 0
              ? h('div', { key: 'external-none', style: styles.sessionMeta }, t('noExternal'))
              : external.map((leaf) => h('div', { key: leaf.externalId, style: styles.sessionRow }, [
                  h('span', { key: 'title', style: styles.sessionTitle }, leaf.label),
                  h('span', { key: 'meta', style: styles.sessionMeta }, leaf.mode),
                  h('button', {
                    key: 'add',
                    type: 'button',
                    style: styles.button,
                    disabled: busy,
                    onClick: () => onAddExternal(leaf),
                  }, t('add')),
                ])),
        ]),
      ])
    }

    function TaskBoard(props) {
      const { tasks, nodes, busy, t, onCreate, onUpdate } = props
      const [subject, setSubject] = React.useState('')
      const [description, setDescription] = React.useState('')
      const [owner, setOwner] = React.useState('')
      const owners = nodes.filter((node) => node.kind === 'session')
      const statusKey = {
        pending: 'statusPending',
        in_progress: 'statusInProgress',
        completed: 'statusCompleted',
      }
      const add = () => {
        onCreate(subject, description, owner.length > 0 ? owner : null)
        setSubject('')
        setDescription('')
        setOwner('')
      }
      return h('div', { style: styles.board }, [
        h('div', { key: 'title', style: styles.sectionTitle }, t('tasks')),
        h('div', { key: 'form', style: styles.taskForm }, [
          h('input', {
            key: 'subject',
            style: styles.input,
            placeholder: t('taskSubject'),
            value: subject,
            onChange: (event) => setSubject(event.target.value),
          }),
          h('input', {
            key: 'description',
            style: styles.input,
            placeholder: t('taskDescription'),
            value: description,
            onChange: (event) => setDescription(event.target.value),
          }),
          h('select', {
            key: 'owner',
            style: styles.select,
            value: owner,
            onChange: (event) => setOwner(event.target.value),
          }, [
            h('option', { key: 'none', value: '' }, t('unowned')),
            ...owners.map((node) => h('option', { key: node.id, value: node.id }, node.label)),
          ]),
          h('button', {
            key: 'add',
            type: 'button',
            style: styles.button,
            disabled: busy || subject.trim().length === 0,
            onClick: add,
          }, t('addTask')),
        ]),
        tasks.length === 0
          ? h('div', { key: 'none', style: styles.sessionMeta }, t('noTasks'))
          : tasks.map((task) => {
              const ownerNode = nodes.find((node) => node.id === task.ownerNodeId)
              return h('div', { key: task.id, style: styles.taskRow }, [
                h('div', { key: 'main', style: { flex: '1 1 auto', minWidth: 0 } }, [
                  h('div', { key: 'subject', style: { fontWeight: 500 } }, task.subject),
                  h('div', { key: 'meta', style: styles.sessionMeta }, [
                    h('span', { key: 'status', style: styles.badge }, t(statusKey[task.status] ?? 'statusPending')),
                    ' ',
                    ownerNode === undefined ? t('unowned') : ownerNode.label,
                  ]),
                  task.description ? h('div', { key: 'description', style: styles.sessionMeta }, task.description) : null,
                ]),
                h('div', { key: 'actions', style: styles.confirmRow }, [
                  task.status === 'pending'
                    ? h('button', { key: 'start', type: 'button', style: styles.button, disabled: busy, onClick: () => onUpdate(task.id, 'start', task.revision) }, t('taskStart'))
                    : null,
                  task.status === 'in_progress'
                    ? h('button', { key: 'complete', type: 'button', style: styles.button, disabled: busy, onClick: () => onUpdate(task.id, 'complete', task.revision) }, t('taskComplete'))
                    : null,
                  task.status === 'completed'
                    ? h('button', { key: 'reopen', type: 'button', style: styles.button, disabled: busy, onClick: () => onUpdate(task.id, 'reopen', task.revision) }, t('taskReopen'))
                    : null,
                  h('button', {
                    key: 'delete',
                    type: 'button',
                    style: styles.danger,
                    disabled: busy,
                    onClick: () => {
                      if (window.confirm(t('taskDeleteConfirm'))) onUpdate(task.id, 'delete', task.revision)
                    },
                  }, t('taskDelete')),
                ]),
              ])
            }),
      ])
    }

    function CompositionTab(props) {
      const { sessionId, t, openSession } = props
      const [state, setState] = React.useState({
        loading: true, error: null, composition: null, observations: {}, grants: {}, tasks: [], storage: 'unknown', rootSessionId: null,
      })
      const [picker, setPicker] = React.useState({
        open: false, sessions: [], external: [], externalAvailable: false, query: '', parentId: '', titles: {},
      })
      const [pendingRemove, setPendingRemove] = React.useState(null)
      const [expanded, setExpanded] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      const [editingTitle, setEditingTitle] = React.useState(false)
      const [titleDraft, setTitleDraft] = React.useState('')
      const requestedTitles = React.useRef(new Set())

      const load = React.useCallback(async (options = {}) => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          setState({ loading: false, error: null, composition: null, observations: {}, grants: {}, tasks: [], storage: 'unknown', rootSessionId: null })
          return
        }
        if (options.silent !== true) setState((previous) => ({ ...previous, loading: true, error: null }))
        try {
          const data = await callApi(`/state?sessionId=${encodeURIComponent(sessionId)}`)
          setState({
            loading: false,
            error: null,
            composition: data.composition ?? null,
            observations: data.observations ?? {},
            grants: data.grants ?? {},
            tasks: data.tasks ?? [],
            storage: data.storage ?? 'unknown',
            rootSessionId: data.rootSessionId ?? data.composition?.rootSessionId ?? null,
          })
        } catch (error) {
          setState({ loading: false, error, composition: null, observations: {}, grants: {}, tasks: [], storage: 'unknown', rootSessionId: null })
        }
      }, [sessionId])

      React.useEffect(() => {
        void load()
      }, [load])

      React.useEffect(() => {
        setEditingTitle(false)
      }, [sessionId])

      const mutate = React.useCallback(async (action, successMessage) => {
        setBusy(true)
        setNotice(null)
        try {
          await action()
          await load({ silent: true })
          setNotice(successMessage ?? null)
          window.dispatchEvent(new CustomEvent(COMPOSITION_CHANGED, { detail: { sessionId } }))
        } catch (error) {
          setNotice(error.code === 'AGENT_BUSY' ? t('agentBusy') : error.message)
        } finally {
          setBusy(false)
        }
      }, [load, t])

      const activeRoot = state.rootSessionId ?? sessionId

      const requestTitles = React.useCallback(async (ids) => {
        const missing = ids.filter((id) => typeof id === 'string' && id.length > 0 && !requestedTitles.current.has(id))
        if (missing.length === 0) return
        for (const id of missing) requestedTitles.current.add(id)
        const chunks = []
        for (let index = 0; index < missing.length; index += 10) {
          chunks.push(missing.slice(index, index + 10))
        }
        await Promise.all(chunks.map(async (chunk) => {
          try {
            const data = await callApi(`/titles?ids=${encodeURIComponent(chunk.join(','))}`)
            setPicker((previous) => ({
              ...previous,
              titles: { ...previous.titles, ...(data.titles ?? {}) },
            }))
          } catch {
            // Titles are cosmetic; ids remain usable.
          }
        }))
      }, [])

      const create = () => mutate(
        () => callApi('/create', { method: 'POST', body: { rootSessionId: sessionId } }),
        null,
      )

      const openPicker = async () => {
        setPicker((previous) => ({ ...previous, open: true }))
        try {
          const [sessionData, externalData] = await Promise.all([
            callApi('/sessions'),
            callApi(`/external?rootSessionId=${encodeURIComponent(activeRoot)}`),
          ])
          setPicker((previous) => ({
            ...previous,
            sessions: sessionData.sessions ?? [],
            external: externalData.leaves ?? [],
            externalAvailable: externalData.available === true,
          }))
        } catch (error) {
          setNotice(error.message)
        }
      }

      const addSession = (session) => mutate(
        () => callApi('/add-node', {
          method: 'POST',
          body: {
            rootSessionId: activeRoot,
            sessionId: session.sessionId,
            parentId: picker.parentId.length > 0 ? picker.parentId : null,
          },
        }),
        null,
      )

      const addExternal = (leaf) => mutate(
        () => callApi('/add-external', {
          method: 'POST',
          body: {
            rootSessionId: activeRoot,
            label: leaf.label,
            provider: leaf.mode,
            nativeParentSessionId: leaf.nativeParentSessionId,
            parentId: picker.parentId.length > 0 ? picker.parentId : null,
          },
        }),
        null,
      )

      const renameNode = (nodeId, label) => mutate(
        () => callApi('/rename-node', {
          method: 'POST',
          body: { rootSessionId: activeRoot, nodeId, label },
        }),
        null,
      )

      const renameComposition = (title) => mutate(
        () => callApi('/set-title', {
          method: 'POST',
          body: { rootSessionId: activeRoot, title },
        }),
        null,
      )

      const runClone = (path, body, doneKey) => {
        if (!window.confirm(t(path === '/clone-tree' ? 'cloneTreeConfirm' : 'budConfirm'))) return
        setBusy(true)
        setNotice(null)
        callApi(path, { method: 'POST', body })
          .then((data) => {
            const newRoot = data?.clone?.newRootSessionId
            setNotice(format(t, doneKey, { session: typeof newRoot === 'string' ? newRoot : t('none') }))
            if (typeof newRoot === 'string' && typeof openSession === 'function') openSession(newRoot)
          })
          .catch((error) => setNotice(error.code === 'AGENT_BUSY' ? t('agentBusy') : error.message))
          .finally(() => setBusy(false))
      }

      const cloneTree = () => runClone('/clone-tree', { rootSessionId: activeRoot }, 'cloneDone')
      const budNode = (nodeId) => runClone('/bud', { rootSessionId: activeRoot, nodeId }, 'budDone')

      const reparentNode = (nodeId, parentId) => mutate(
        () => callApi('/set-parent', {
          method: 'POST',
          body: { rootSessionId: activeRoot, nodeId, parentId },
        }),
        null,
      )

      const syncNative = () => mutate(
        () => callApi('/sync-native', {
          method: 'POST',
          body: { rootSessionId: activeRoot },
        }),
        null,
      )

      const grantEdge = (edgeId, patch) => mutate(
        () => callApi('/set-grant', {
          method: 'POST',
          body: { rootSessionId: activeRoot, edgeId, ...patch },
        }),
        null,
      )

      const createTask = (subject, description, ownerNodeId) => mutate(
        () => callApi('/create-task', {
          method: 'POST',
          body: { rootSessionId: activeRoot, subject, description, ownerNodeId },
        }),
        null,
      )

      const updateTask = (taskId, action, expectedRevision) => mutate(
        () => callApi('/update-task', {
          method: 'POST',
          body: { rootSessionId: activeRoot, taskId, action, expectedRevision },
        }),
        null,
      )

      const toggleExpanded = (nodeId) => {
        setExpanded((previous) => (previous.includes(nodeId)
          ? previous.filter((id) => id !== nodeId)
          : [...previous, nodeId]))
      }

      const openNodeConversation = (targetId) => {
        if (typeof openSession === 'function' && typeof targetId === 'string') openSession(targetId)
      }

      const removeNode = (mode) => {
        if (pendingRemove === null) return
        const node = pendingRemove
        setPendingRemove(null)
        void mutate(
          () => callApi('/remove-node', {
            method: 'POST',
            body: { rootSessionId: activeRoot, nodeId: node.id, mode },
          }),
          null,
        )
      }

      const deleteComposition = () => {
        setConfirmDelete(false)
        void mutate(
          () => callApi('/delete-composition', { method: 'POST', body: { rootSessionId: activeRoot } }),
          null,
        )
      }

      const composition = state.composition
      const tree = React.useMemo(() => treeOf(composition), [composition])
      const nodes = composition?.nodes ?? []

      if (state.loading) return h('div', { style: styles.wrap }, h('div', { key: 'loading' }, t('loading')))
      if (state.error !== null) {
        return h('div', { style: styles.wrap }, [
          h('div', { key: 'error', style: styles.error }, `${t('error')} ${state.error.message}`),
          h('button', { key: 'retry', type: 'button', style: styles.button, onClick: () => void load() }, t('retry')),
        ])
      }

      return h('div', { style: styles.wrap }, [
        h('div', { key: 'header', style: styles.header }, [
          composition !== null && editingTitle
            ? h('div', { key: 'title-edit', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
                h('input', {
                  key: 'input',
                  style: styles.input,
                  value: titleDraft,
                  placeholder: t('tab.title'),
                  onChange: (event) => setTitleDraft(event.target.value),
                }),
                h('button', {
                  key: 'save',
                  type: 'button',
                  style: styles.button,
                  disabled: busy || titleDraft.trim().length === 0,
                  onClick: () => {
                    const title = titleDraft.trim()
                    if (title.length === 0) return
                    setEditingTitle(false)
                    void renameComposition(title)
                  },
                }, t('save')),
                h('button', {
                  key: 'cancel',
                  type: 'button',
                  style: styles.linkButton,
                  onClick: () => setEditingTitle(false),
                }, t('cancel')),
              ])
            : h('h2', {
                key: 'title',
                style: { ...styles.title, display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
              }, [
                h('span', { key: 'text' }, composition?.title ?? t('tab.title')),
                composition === null
                  ? null
                  : h('button', {
                      key: 'edit',
                      type: 'button',
                      style: styles.linkButton,
                      disabled: busy,
                      onClick: () => {
                        setTitleDraft(composition.title)
                        setEditingTitle(true)
                      },
                    }, t('editTitle')),
              ]),
          h('span', { key: 'root', style: styles.rootId }, sessionId),
          composition === null ? null : h('span', { key: 'count', style: styles.badge }, format(t, 'nodeCount', { count: String(nodes.length) })),
          h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
          composition === null
            ? null
            : h('button', {
                key: 'clone',
                type: 'button',
                style: styles.button,
                disabled: busy,
                onClick: cloneTree,
              }, t('cloneTree')),
          composition === null
            ? null
            : h('button', {
                key: 'sync',
                type: 'button',
                style: styles.linkButton,
                disabled: busy,
                onClick: () => void syncNative(),
              }, t('syncNative')),
          h('button', { key: 'reload', type: 'button', style: styles.linkButton, onClick: () => void load() }, t('retry')),
        ]),
        h('div', { key: 'notice', style: styles.notice }, t('notice')),
        state.storage === 'memory' ? h('div', { key: 'memory', style: styles.warning }, t('storageMemory')) : null,
        notice === null ? null : h('div', { key: 'notice-error', style: styles.error }, notice),
        composition === null
          ? h('div', { key: 'empty', style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' } }, [
              h('div', { key: 'text', style: { color: 'var(--dsw-alias-label-secondary)' } }, t('empty')),
              h('button', { key: 'create', type: 'button', style: styles.button, disabled: busy, onClick: create }, t('create')),
            ])
          : h('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
              tree === null ? null : h('div', { key: 'tree', style: styles.tree }, tree.roots.map((node) => h(NodeRow, {
                key: node.id,
                node,
                depth: 0,
                tree,
                composition,
                observations: state.observations,
                t,
                pendingRemove,
                setPendingRemove,
                busy,
                onRemove: removeNode,
                expanded,
                onToggle: toggleExpanded,
                allNodes: nodes,
                onRename: renameNode,
                onReparent: reparentNode,
                onOpen: openNodeConversation,
                openAvailable: typeof openSession === 'function',
                grants: state.grants,
                onGrant: grantEdge,
                onBud: budNode,
              }))),
              picker.open
                ? h(SessionPicker, {
                    key: 'picker',
                    sessions: picker.sessions,
                    external: picker.external,
                    externalAvailable: picker.externalAvailable,
                    titles: picker.titles,
                    onNeedTitles: requestTitles,
                    query: picker.query,
                    setQuery: (query) => setPicker((previous) => ({ ...previous, query })),
                    parentId: picker.parentId,
                    setParentId: (parentId) => setPicker((previous) => ({ ...previous, parentId })),
                    nodes,
                    busy,
                    onAdd: addSession,
                    onAddExternal: addExternal,
                    t,
                  })
                : h('button', { key: 'open-picker', type: 'button', style: styles.button, disabled: busy, onClick: () => void openPicker() }, t('addSession')),
              h(TaskBoard, {
                key: 'tasks',
                tasks: state.tasks ?? [],
                nodes,
                busy,
                t,
                onCreate: createTask,
                onUpdate: updateTask,
              }),
              confirmDelete
                ? h('div', { key: 'delete-confirm', style: styles.confirm }, [
                    h('div', { key: 'text' }, t('deleteConfirm')),
                    h('div', { key: 'actions', style: styles.confirmRow }, [
                      h('button', { key: 'yes', type: 'button', style: styles.danger, disabled: busy, onClick: deleteComposition }, t('confirmDelete')),
                      h('button', { key: 'no', type: 'button', style: styles.linkButton, onClick: () => setConfirmDelete(false) }, t('cancel')),
                    ]),
                  ])
                : h('button', { key: 'delete', type: 'button', style: styles.linkButton, disabled: busy, onClick: () => setConfirmDelete(true) }, t('deleteComposition')),
            ]),
      ])
    }

    function CompositionHeaderAction(props) {
      const { sessionId, t, ctx } = props
      const [summary, setSummary] = React.useState(null)
      const [revision, setRevision] = React.useState(0)
      React.useEffect(() => {
        const onChange = (event) => {
          if (event?.detail?.sessionId === sessionId) setRevision((value) => value + 1)
        }
        window.addEventListener(COMPOSITION_CHANGED, onChange)
        return () => window.removeEventListener(COMPOSITION_CHANGED, onChange)
      }, [sessionId])
      React.useEffect(() => {
        let cancelled = false
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        callApi(`/summary?sessionId=${encodeURIComponent(sessionId)}`)
          .then((data) => { if (!cancelled) setSummary(data) })
          .catch(() => { if (!cancelled) setSummary(null) })
        return () => { cancelled = true }
      }, [sessionId, revision])
      const sidebar = ctx.get('sidebarRight')
      if (sidebar === undefined || summary === null) return null
      const native = summary.subagents ?? 0
      const total = Math.max(native, summary.compositionNodes ?? 0)
      if (native === 0 && (summary.compositionNodes ?? 0) <= 1) return null
      return h('button', {
        type: 'button',
        title: `${t('header.tooltip')} \u00b7 ${summary.compositionNodes ?? 0} nodes`,
        'aria-label': `${t('header.tooltip')} (${total})`,
        style: styles.headerChip,
        onClick: () => {
          try {
            sidebar.openTab(KIND)
          } catch (error) {
            console.error('dsh-combinagents: cannot open tab', error)
          }
        },
      }, [
        h('svg', {
          key: 'icon',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }, [
          h('circle', { key: 'a', cx: 4, cy: 4, r: 1.8 }),
          h('circle', { key: 'b', cx: 12, cy: 4, r: 1.8 }),
          h('circle', { key: 'c', cx: 8, cy: 12, r: 1.8 }),
          h('path', { key: 'l1', d: 'M5.3 5.1 7 10.3' }),
          h('path', { key: 'l2', d: 'M10.7 5.1 9 10.3' }),
        ]),
        h('span', { key: 'count' }, String(total)),
      ])
    }

    function HeaderButton(props) {
      const { t, ctx } = props
      const sidebar = ctx.get('sidebarRight')
      if (sidebar === undefined) return null
      return h('button', {
        type: 'button',
        title: t('header.tooltip'),
        'aria-label': t('header.tooltip'),
        style: styles.iconButton,
        onClick: () => {
          try {
            sidebar.openTab(KIND)
          } catch (error) {
            console.error('dsh-combinagents: cannot open tab', error)
          }
        },
      }, h('svg', {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
      }, [
        h('circle', { key: 'a', cx: 4, cy: 4, r: 2 }),
        h('circle', { key: 'b', cx: 12, cy: 4, r: 2 }),
        h('circle', { key: 'c', cx: 8, cy: 12, r: 2 }),
        h('path', { key: 'l1', d: 'M5.4 5.1 7 10.2' }),
        h('path', { key: 'l2', d: 'M10.6 5.1 9 10.2' }),
      ]))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, 'en', DICTS.en),
            ctx.locale.register(NS, 'zh', DICTS.zh),
          ]
          return () => {
            for (const dispose of disposers.reverse()) dispose()
          }
        }, 'dsh-combinagents: locale')

        const openSession = (target) => {
          try {
            ctx.get('uiWorkspace')?.openSession?.(target)
          } catch (error) {
            console.error('dsh-combinagents: cannot open session', error)
          }
        }
        const TabBody = (props) => h(CompositionTab, { ...props, t, openSession })
        const HeaderUtility = (props) => h(HeaderButton, { ...props, t, ctx })
        const HeaderCount = (props) => h(CompositionHeaderAction, { ...props, t, ctx })

        ctx.effect(() => ctx.inject(['sidebarRightTabs'], (scope) => {
          const tabs = scope.sidebarRightTabs
          const disposeType = tabs.register({
            id: TAB_ID,
            kind: KIND,
            title: () => t('tab.title'),
            guide: [
              {
                id: 'composition',
                order: 60,
                title: () => t('guide.title'),
                description: () => t('guide.description'),
              },
            ],
          })
          const disposeBody = scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
          }, TabBody))
          const disposeHeader = scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
            name: 'conversation.session.header.utilities',
            id: TAB_ID,
            order: 40,
          }, HeaderUtility))
          const disposeCount = scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
            name: 'conversation.session.header.actions',
            id: 'dsh-combinagents-count',
            order: 11,
            locale: NS,
          }, HeaderCount))
          return () => {
            disposeCount()
            disposeHeader()
            disposeBody()
            disposeType()
          }
        }), 'dsh-combinagents: right sidebar')
      },
    }
  },
})
