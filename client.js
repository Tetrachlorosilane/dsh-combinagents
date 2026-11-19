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
    const ReactDOM = (() => {
      try {
        return require('react-dom')
      } catch {
        return null
      }
    })()
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
        'cloneEstimate': 'Creates {sessions} new sessions and copies about {size} of history. Repeating clone/bud grows storage linearly.',
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
        'pickerLimit': 'Showing the first 200 matches. Refine the filter to narrow the list.',
        'parent': 'Reports to',
        'noParent': 'No parent (root)',
        'remove': 'Remove',
        'removeTitle': 'Remove from composition',
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
        'mode': 'Mode',
        'modeContinuable': 'Continuable',
        'modeOneShot': 'One-shot',
        'modeExternal': 'External',
        'modeUnknown': 'Unknown',
        'showOneShot': 'Show one-shot agents',
        'cwd': 'Workspace',
        'provider': 'Provider',
        'none': '\u2014',
        'agentBusy': 'An affected agent or one of its lineage is running; wait for it to finish.',
        'nativeMessagingNote': 'Messages follow the native subagent tree, not this composition edge.',
        'syncNative': 'Sync native agents',
        'grantMessage': 'Allow messages across this edge',
        'grantInterrupt': 'Allow parent to interrupt child',
        'tasks': 'Shared tasks',
        'teams': 'Teams',
        'createTeam': 'Create team',
        'teamLabel': 'Team label',
        'teamLead': 'Team lead (subtree root)',
        'teamHint': 'A team is a connected set of nodes; its lead seeds the subtree, then uncheck members. Tasks use the native Team board shape.',
        'teamMembers': 'members',
        'deleteTeam': 'Delete team',
        'teamDeleteConfirm': 'Delete this team and its scoped tasks? The composition nodes stay unchanged.',
        'compositionBoard': 'Composition board',
        'taskSubject': 'Task',
        'taskDescription': 'Details',
        'taskOwner': 'Owner',
        'noTasks': 'No tasks yet.',
        'addTask': 'Add task',
        'taskStart': 'Start',
        'taskComplete': 'Complete',
        'taskReopen': 'Reopen',
        'taskDelete': 'Delete',
        'taskDeleteTitle': 'Delete task',
        'taskDeleteConfirm': 'Delete this task? It exists only in the plugin task board.',
        'taskProgressCompleted': '{count} completed',
        'taskProgressActive': '{count} in progress',
        'taskProgressPending': '{count} pending',
        'taskOwner': 'Owner',
        'taskBlocked': 'Blocked',
        'taskBlockedBy': 'Blocked by',
        'taskWriteScopes': 'Write scopes',
        'cleanup': 'Session cleanup',
        'cleanupHint': 'Preview orphaned clone sessions and one-shot placeholders that are no longer part of any composition. Deletion is a separate, confirmed step; only inactive, unowned sessions can be removed.',
        'cleanupCheck': 'Preview',
        'cleanupDelete': 'Delete selected',
        'cleanupChecking': 'Loading preview…',
        'cleanupDeleting': 'Deleting sessions…',
        'cleanupNone': 'No orphaned or one-shot sessions found.',
        'cleanupSummary': 'Wild: {wild} · historical suspects: {legacy} · one-shot nodes: {oneShot} · {size}',
        'cleanupWild': 'Wild',
        'cleanupLegacy': 'Historical suspects',
        'cleanupOneShot': 'One-shot',
        'cleanupMore': '+{count} more',
        'cleanupPreviewContent': 'Preview content',
        'cleanupLoadingContent': 'Loading…',
        'cleanupFirstUser': 'First user message',
        'cleanupLastMessage': 'Last message',
        'cleanupNoContent': 'No previewable text.',
        'cleanupContentFailed': 'Could not load preview.',
        'cleanupLegacyOption': 'Include historical suspects (seeded, no composition)',
        'cleanupConfirm': 'Permanently delete {count} item(s), about {size}? This cannot be undone.',
        'cleanupDone': 'Deleted {count} item(s), freed {size}.',
        'cleanupPartial': '{count} item(s) could not be deleted; review the session list.',
        'cleanupCheckFailed': 'Session check failed.',
        'cleanupUnavailable': 'Session cleanup is unavailable for this storage backend.',
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
        'cloneEstimate': '将创建 {sessions} 个新 Session，并复制约 {size} 的历史。重复 clone/bud 会线性增长存储。',
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
        'pickerLimit': '仅显示前 200 个匹配项；请细化筛选条件以缩小范围。',
        'parent': '汇报给',
        'noParent': '无上级（根节点）',
        'remove': '移除',
        'removeTitle': '从组合中移除',
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
        'mode': '模式',
        'modeContinuable': '可继续',
        'modeOneShot': '一次性',
        'modeExternal': '外部',
        'modeUnknown': '未知',
        'showOneShot': '显示一次性代理',
        'cwd': '工作区',
        'provider': 'Provider',
        'none': '—',
        'agentBusy': '受影响代理或其父系正在工作；请等它完成后再编辑。',
        'nativeMessagingNote': '消息仍按原生子代理树传递，不经过这条组合边。',
        'syncNative': '同步原生子代理',
        'grantMessage': '允许该边双向消息',
        'grantInterrupt': '允许父节点中断子节点',
        'tasks': '共享任务',
        'teams': '团队',
        'createTeam': '创建团队',
        'teamLabel': '团队名称',
        'teamLead': '团队负责人（子树根）',
        'teamHint': '团队是一组连通的节点；选择 lead 会预选其子树，可继续取消成员。团队任务使用原生 Team 任务板形状。',
        'teamMembers': '个成员',
        'deleteTeam': '删除团队',
        'teamDeleteConfirm': '删除这个团队及其范围内的任务？组合节点本身不变。',
        'compositionBoard': '组合任务板',
        'taskSubject': '任务',
        'taskDescription': '详情',
        'taskOwner': '负责人',
        'noTasks': '还没有任务。',
        'addTask': '添加任务',
        'taskStart': '开始',
        'taskComplete': '完成',
        'taskReopen': '重新打开',
        'taskDelete': '删除',
        'taskDeleteTitle': '删除任务',
        'taskDeleteConfirm': '删除这个任务？它只存在于插件任务板，不是 DSH Team。',
        'taskProgressCompleted': '{count} 已完成',
        'taskProgressActive': '{count} 进行中',
        'taskProgressPending': '{count} 待处理',
        'taskOwner': '负责人',
        'taskBlocked': '受阻',
        'taskBlockedBy': '依赖',
        'taskWriteScopes': '写入范围',
        'cleanup': '会话清理',
        'cleanupHint': '预览已脱离组合的克隆会话和一次性占位。删除是独立的确认步骤；只能删除非 live、无组合归属的会话。',
        'cleanupCheck': '预览',
        'cleanupDelete': '删除选中',
        'cleanupChecking': '正在加载预览…',
        'cleanupDeleting': '正在删除会话…',
        'cleanupNone': '没有发现野会话或一次性会话。',
        'cleanupSummary': '野会话：{wild} · 历史疑似：{legacy} · 一次性节点：{oneShot} · {size}',
        'cleanupWild': '野会话',
        'cleanupLegacy': '历史疑似',
        'cleanupOneShot': '一次性',
        'cleanupMore': '还有 {count} 项',
        'cleanupPreviewContent': '预览内容',
        'cleanupLoadingContent': '加载中…',
        'cleanupFirstUser': '首条用户消息',
        'cleanupLastMessage': '最后消息',
        'cleanupNoContent': '没有可预览的文本。',
        'cleanupContentFailed': '无法加载预览。',
        'cleanupLegacyOption': '包含历史疑似项（seeded、无组合归属）',
        'cleanupConfirm': '永久删除 {count} 项，约 {size}？此操作不可撤销。',
        'cleanupDone': '已删除 {count} 项，释放 {size}。',
        'cleanupPartial': '有 {count} 项未能删除，请检查会话列表。',
        'cleanupCheckFailed': '会话检查失败。',
        'cleanupUnavailable': '当前存储后端不支持会话清理。',
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
        flex: '1 1 auto',
        height: '100%',
        maxHeight: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        scrollbarGutter: 'stable',
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
      confirmRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      modalRoot: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(24px, var(--dsh-frame-overlay-top, 24px)) 24px',
        boxSizing: 'border-box',
      },
      modalMask: {
        position: 'absolute',
        inset: 'var(--dsh-frame-chrome-top, 0px) 0 0',
        background: 'var(--dsw-alias-bg-mask-1)',
        backdropFilter: 'var(--dsw-mask-blur)',
      },
      modal: {
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: 'min(420px, 100%)',
        maxHeight: 'calc(100dvh - 48px)',
        overflowY: 'auto',
        padding: '22px 24px 20px',
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-panel)',
        background: 'var(--dsw-alias-bg-layer-2)',
        boxShadow: 'var(--dsw-elevation-prominent)',
        color: 'var(--dsw-alias-label-primary)',
      },
      modalTitle: {
        margin: 0,
        fontSize: '16px',
        lineHeight: '24px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary)',
      },
      modalMessage: {
        margin: 0,
        fontSize: '14px',
        lineHeight: '22px',
        color: 'var(--dsw-alias-label-secondary)',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
      },
      modalActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
        flexWrap: 'wrap',
        paddingTop: '4px',
      },
      primary: {
        border: '1px solid var(--dsw-alias-button-primary-fill)',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)',
        borderRadius: '6px',
        padding: '5px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
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
      taskHeader: { display: 'flex', alignItems: 'center', gap: '6px' },
      taskGlyph: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      taskProgress: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        marginLeft: 'auto',
      },
      taskList: {
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      },
      taskItem: {
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        padding: '1px 0',
      },
      taskToggle: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        minWidth: 0,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        padding: '4px 2px',
        fontSize: '12px',
        textAlign: 'left',
        cursor: 'pointer',
      },
      taskDot: {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        flex: '0 0 auto',
      },
      taskSubject: {
        flex: '1 1 auto',
        minWidth: 0,
        overflowWrap: 'anywhere',
      },
      taskOwner: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        whiteSpace: 'nowrap',
      },
      taskChevron: { color: 'var(--dsw-alias-label-secondary)', fontSize: '10px' },
      taskDetails: {
        margin: '2px 0 6px 13px',
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        overflowWrap: 'anywhere',
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
     * @param {unknown} value - byte count.
     * @returns {string} compact human-readable size.
     */
    function formatBytes(value) {
      const bytes = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
      if (bytes < 1024) return `${Math.round(bytes)} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let amount = bytes / 1024
      let index = 0
      while (amount >= 1024 && index < units.length - 1) {
        amount /= 1024
        index += 1
      }
      return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
    }

    /**
     * Native lifecycle mode with a safe fallback for records written before
     * mode existed.
     * @param {object} node - composition node.
     * @returns {'continuable'|'one-shot'|'external'|'unknown'}
     */
    function modeOf(node) {
      if (node?.mode === 'continuable' || node?.mode === 'one-shot'
        || node?.mode === 'external' || node?.mode === 'unknown') return node.mode
      if (node?.kind === 'external') return 'external'
      return node?.source === 'subagent' ? 'unknown' : 'continuable'
    }

    /**
     * @param {object} node - composition node.
     * @param {(key: string) => string} t - bound translate.
     * @returns {string}
     */
    function modeLabel(node, t) {
      const mode = modeOf(node)
      return t(mode === 'one-shot' ? 'modeOneShot'
        : mode === 'continuable' ? 'modeContinuable'
          : mode === 'external' ? 'modeExternal' : 'modeUnknown')
    }

    /**
     * Hide one-shot agents by default; keep edges only between visible nodes.
     * @param {object|null} composition - validated graph.
     * @param {boolean} includeOneShot - whether to show one-shot nodes.
     * @returns {object|null}
     */
    function visibleComposition(composition, includeOneShot) {
      if (composition === null || composition === undefined || includeOneShot) return composition
      const nodes = composition.nodes.filter((node) => modeOf(node) !== 'one-shot')
      if (nodes.length === composition.nodes.length) return composition
      const ids = new Set(nodes.map((node) => node.id))
      return {
        ...composition,
        nodes,
        edges: composition.edges.filter((edge) => ids.has(edge.parentId) && ids.has(edge.childId)),
      }
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
        rows.push(h(DetailRow, { key: 'mode', label: t('mode'), value: modeLabel(node, t), t }))
        rows.push(h(DetailRow, { key: 'provider', label: t('provider'), value: node.provider ?? t('none'), t }))
        rows.push(h(DetailRow, { key: 'parent', label: t('nativeParent'), value: node.nativeParentSessionId ?? t('none'), t }))
        rows.push(h('div', { key: 'external', style: styles.detailRow }, t('externalNote')))
        rows.push(h('div', {
          key: 'native-messaging',
          style: { ...styles.detailRow, color: 'var(--dsw-alias-label-secondary)' },
        }, t('nativeMessagingNote')))
      } else {
        rows.push(h(DetailRow, { key: 'id', label: t('sessionId'), value: node.sessionId, t }))
        rows.push(h(DetailRow, {
          key: 'mode',
          label: t('mode'),
          value: modeLabel(node, t),
          t,
        }))
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
        node, depth, tree, composition, observations, t, setPendingRemove, busy,
        expanded, onToggle, allNodes, onRename, onReparent, onOpen, openAvailable,
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
            setPendingRemove,
            busy,
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
        external, externalAvailable, onAddExternal, titles, onNeedTitles, onClose,
      } = props
      const text = query.trim().toLowerCase()
      const labelOf = (session) => titles[session.sessionId] ?? session.title
      const filtered = text.length === 0
        ? sessions
        : sessions.filter((session) => `${labelOf(session)} ${session.sessionId} ${session.cwd ?? ''}`.toLowerCase().includes(text))
      const visible = filtered.slice(0, 200)
      const truncated = filtered.length > visible.length
      const visibleKey = visible.slice(0, 20).map((session) => session.sessionId).join(',')
      React.useEffect(() => {
        if (visible.length > 0) onNeedTitles(visible.slice(0, 20).map((session) => session.sessionId))
      }, [visibleKey, onNeedTitles])
      return h('div', {
        style: styles.picker,
        onKeyDown: (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        },
      }, [
        h('div', { key: 'header', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
          h('div', { key: 'title', style: { ...styles.sectionTitle, flex: '1 1 auto' } }, t('addSession')),
          h('button', { key: 'cancel', type: 'button', style: styles.linkButton, onClick: onClose }, t('cancel')),
        ]),
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
          truncated ? h('div', { key: 'limit', style: styles.sessionMeta }, t('pickerLimit')) : null,
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

    /**
     * DSH-themed confirmation surface. It replaces browser `window.confirm`
     * dialogs so destructive actions stay inside the app's visual language.
     * The dialog is deliberately not portaled: a fixed overlay already escapes
     * the sidebar scroll container, and the plugin keeps its client surface to
     * the shared React runtime.
     */
    function ConfirmDialog(props) {
      const {
        title, message, confirmLabel, cancelLabel, secondaryLabel, onConfirm,
        onSecondary, onCancel, danger = false, secondaryDanger = false, busy = false,
      } = props
      const titleId = React.useId()
      const messageId = React.useId()
      const dialogRef = React.useRef(null)
      const previousFocus = React.useRef(null)
      React.useEffect(() => {
        if (typeof document !== 'undefined') previousFocus.current = document.activeElement
        dialogRef.current?.focus?.()
        return () => {
          previousFocus.current?.focus?.()
        }
      }, [])
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onCancel()
            return
          }
          if (event.key !== 'Tab' || dialogRef.current === null) return
          const focusable = [...dialogRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )]
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [busy, onCancel])
      const dismissFromMask = (event) => {
        if (!busy && event.target === event.currentTarget) onCancel()
      }
      const content = h('div', { style: styles.modalRoot }, [
        h('div', { key: 'mask', style: styles.modalMask, onClick: dismissFromMask }),
        h('div', {
          key: 'dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
          'aria-describedby': message ? messageId : undefined,
          tabIndex: -1,
          ref: dialogRef,
          style: styles.modal,
        }, [
          h('h2', { key: 'title', id: titleId, style: styles.modalTitle }, title),
          message ? h('p', { key: 'message', id: messageId, style: styles.modalMessage }, message) : null,
          h('div', { key: 'actions', style: styles.modalActions }, [
            h('button', {
              key: 'cancel',
              type: 'button',
              style: styles.button,
              disabled: busy,
              onClick: onCancel,
            }, cancelLabel),
            secondaryLabel ? h('button', {
              key: 'secondary',
              type: 'button',
              style: secondaryDanger ? styles.danger : styles.button,
              disabled: busy,
              onClick: onSecondary,
            }, secondaryLabel) : null,
            h('button', {
              key: 'confirm',
              type: 'button',
              style: danger ? styles.danger : styles.primary,
              disabled: busy,
              onClick: onConfirm,
            }, confirmLabel),
          ]),
        ]),
      ])
      if (ReactDOM?.createPortal !== undefined && typeof document !== 'undefined') {
        return ReactDOM.createPortal(content, document.body)
      }
      return content
    }

    function TaskBoard(props) {
      const { tasks, nodes, busy, t, onCreate, onUpdate } = props
      const [subject, setSubject] = React.useState('')
      const [description, setDescription] = React.useState('')
      const [owner, setOwner] = React.useState('')
      const [adding, setAdding] = React.useState(false)
      const [expandedTask, setExpandedTask] = React.useState(null)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const owners = nodes.filter((node) => node.kind === 'session')
      const statusKey = {
        pending: 'statusPending',
        in_progress: 'statusInProgress',
        completed: 'statusCompleted',
      }
      const byId = new Map(tasks.map((task) => [task.id, task]))
      const ready = (task) => task.status === 'pending'
        && (Array.isArray(task.blockedBy) ? task.blockedBy : []).every((id) => byId.get(id)?.status === 'completed')
      const dotColor = (task) => {
        if (task.status === 'completed') return 'var(--dsw-alias-state-success-primary)'
        if (task.status === 'in_progress') return 'var(--dsw-alias-brand-primary)'
        if (task.status === 'pending' && !ready(task)) return 'var(--dsw-alias-state-warn-primary)'
        return 'var(--dsw-alias-label-secondary)'
      }
      const progress = (() => {
        const completed = tasks.filter((task) => task.status === 'completed').length
        const active = tasks.filter((task) => task.status === 'in_progress').length
        const pending = tasks.length - completed - active
        return [
          ...completed > 0 ? [format(t, 'taskProgressCompleted', { count: String(completed) })] : [],
          ...active > 0 ? [format(t, 'taskProgressActive', { count: String(active) })] : [],
          ...pending > 0 ? [format(t, 'taskProgressPending', { count: String(pending) })] : [],
        ].join('\u2002·\u2002')
      })()
      const closeForm = () => {
        setAdding(false)
        setSubject('')
        setDescription('')
        setOwner('')
      }
      const add = async () => {
        const created = await onCreate(subject, description, owner.length > 0 ? owner : null)
        if (created === false) return
        closeForm()
      }
      return h('div', { style: styles.board }, [
        h('div', { key: 'title', style: styles.taskHeader }, [
          h('span', { key: 'glyph', style: styles.taskGlyph, 'aria-hidden': true }, '\u2611'),
          h('span', { key: 'label', style: styles.sectionTitle }, t('tasks')),
          h('span', { key: 'progress', style: styles.taskProgress }, progress),
        ]),
        adding === false
          ? h('button', {
              key: 'open-form',
              type: 'button',
              style: styles.button,
              disabled: busy,
              onClick: () => setAdding(true),
            }, t('addTask'))
          : h('div', {
              key: 'form',
              style: styles.picker,
              onKeyDown: (event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                closeForm()
              },
            }, [
              h('div', { key: 'form-header', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                h('div', { key: 'title', style: { ...styles.sectionTitle, flex: '1 1 auto' } }, t('addTask')),
                h('button', { key: 'cancel', type: 'button', style: styles.linkButton, onClick: closeForm }, t('cancel')),
              ]),
              h('div', { key: 'fields', style: styles.taskForm }, [
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
                  onClick: () => void add(),
                }, t('addTask')),
              ]),
            ]),
        tasks.length === 0
          ? h('div', { key: 'none', style: styles.sessionMeta }, t('noTasks'))
          : h('ul', { key: 'list', style: styles.taskList }, tasks.map((task) => {
              const ownerNode = nodes.find((node) => node.id === task.ownerNodeId)
              const ownerLabel = typeof task.ownerName === 'string' && task.ownerName.length > 0
                ? task.ownerName
                : ownerNode === undefined ? t('unowned') : ownerNode.label
              const blocked = task.status === 'pending' && !ready(task)
              const open = expandedTask === task.id
              return h('li', { key: task.id, style: styles.taskItem }, [
                h('button', {
                  key: 'toggle',
                  type: 'button',
                  style: styles.taskToggle,
                  'aria-expanded': open,
                  onClick: () => setExpandedTask((current) => current === task.id ? null : task.id),
                }, [
                  h('span', { key: 'dot', style: { ...styles.taskDot, background: dotColor(task) }, title: blocked ? t('taskBlocked') : t(statusKey[task.status] ?? 'statusPending') }),
                  h('span', { key: 'subject', style: styles.taskSubject }, task.subject),
                  h('span', { key: 'owner', style: styles.taskOwner }, ownerLabel),
                  h('span', { key: 'chevron', style: styles.taskChevron, 'aria-hidden': true }, open ? '\u25be' : '\u25b8'),
                ]),
                open ? h('div', { key: 'details', style: styles.taskDetails }, [
                  task.description ? h('div', { key: 'description' }, task.description) : null,
                  h('div', { key: 'owner' }, `${t('taskOwner')}: ${ownerLabel}`),
                  task.status === 'pending' || task.status === 'in_progress' ? h('select', {
                    key: 'owner-select',
                    style: styles.select,
                    value: task.ownerNodeId ?? '',
                    disabled: busy,
                    onChange: (event) => onUpdate(task.id, 'reassign', task.revision, event.target.value.length === 0 ? null : event.target.value),
                  }, [
                    h('option', { key: 'none', value: '' }, t('unowned')),
                    ...owners.map((node) => h('option', { key: node.id, value: node.id }, node.label)),
                  ]) : null,
                  blocked ? h('div', { key: 'blocked', style: styles.warning }, t('taskBlocked')) : null,
                  Array.isArray(task.blockedBy) && task.blockedBy.length > 0
                    ? h('div', { key: 'blocked-by' }, `${t('taskBlockedBy')}: ${task.blockedBy.join(', ')}`)
                    : null,
                  Array.isArray(task.writeScopes) && task.writeScopes.length > 0
                    ? h('div', { key: 'scopes' }, `${t('taskWriteScopes')}: ${task.writeScopes.join(', ')}`)
                    : null,
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
                      onClick: () => setPendingDelete(task),
                    }, t('taskDelete')),
                  ]),
                ]) : null,
              ])
            })),
        pendingDelete === null ? null : h(ConfirmDialog, {
          key: 'task-delete-dialog',
          title: t('taskDeleteTitle'),
          message: t('taskDeleteConfirm'),
          confirmLabel: t('taskDelete'),
          cancelLabel: t('cancel'),
          danger: true,
          busy,
          onCancel: () => setPendingDelete(null),
          onConfirm: () => {
            const task = pendingDelete
            setPendingDelete(null)
            if (task !== null) onUpdate(task.id, 'delete', task.revision)
          },
        }),
      ])
    }

    function CompositionTab(props) {
      const { sessionId, t, openSession } = props
      const [state, setState] = React.useState({
        loading: true, error: null, composition: null, observations: {}, grants: {}, tasks: [], teams: [], storage: 'unknown', rootSessionId: null,
      })
      const [picker, setPicker] = React.useState({
        open: false, sessions: [], external: [], externalAvailable: false, query: '', parentId: '', titles: {},
      })
      const [pendingRemove, setPendingRemove] = React.useState(null)
      const [expanded, setExpanded] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [showOneShot, setShowOneShot] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      const [pendingClone, setPendingClone] = React.useState(null)
      const [cleanup, setCleanup] = React.useState({
        loading: false, busy: false, data: null, error: null, notice: null, includeLegacy: false,
      })
      const [cleanupConfirm, setCleanupConfirm] = React.useState(false)
      const [cleanupContent, setCleanupContent] = React.useState({})
      const [cleanupContentBusy, setCleanupContentBusy] = React.useState(null)
      const [activeTeamId, setActiveTeamId] = React.useState(null)
      const restoredTeamFor = React.useRef(null)
      const activeTeamStorageKey = state.rootSessionId === undefined || state.rootSessionId === null
        ? null
        : `dsh-combinagents.active-team.${state.rootSessionId}`
      const [teamForm, setTeamForm] = React.useState(false)
      const [teamLabel, setTeamLabel] = React.useState('')
      const [teamLead, setTeamLead] = React.useState('')
      const [teamSelected, setTeamSelected] = React.useState([])
      const [confirmTeamDelete, setConfirmTeamDelete] = React.useState(false)
      const [editingTitle, setEditingTitle] = React.useState(false)
      const [titleDraft, setTitleDraft] = React.useState('')
      const requestedTitles = React.useRef(new Set())

      const load = React.useCallback(async (options = {}) => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          setState({ loading: false, error: null, composition: null, observations: {}, grants: {}, tasks: [], teams: [], storage: 'unknown', rootSessionId: null })
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
            teams: data.teams ?? [],
            storage: data.storage ?? 'unknown',
            rootSessionId: data.rootSessionId ?? data.composition?.rootSessionId ?? null,
          })
        } catch (error) {
          if (options.silent === true) {
            setState((previous) => ({ ...previous, error }))
          } else {
            setState({ loading: false, error, composition: null, observations: {}, grants: {}, tasks: [], teams: [], storage: 'unknown', rootSessionId: null })
          }
        }
      }, [sessionId])

      React.useEffect(() => {
        void load()
      }, [load])

      // Another profile can mutate the same durable composition. Poll the
      // authoritative bridge while the tab is visible so this UI converges
      // without a reload; a mutation in this tab is never overwritten mid-flight.
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const timer = setInterval(() => {
          if (busy || document.visibilityState === 'hidden') return
          void load({ silent: true })
        }, 3000)
        return () => clearInterval(timer)
      }, [load, busy])

      React.useEffect(() => {
        setEditingTitle(false)
        setShowOneShot(false)
      }, [sessionId])

      React.useEffect(() => {
        if (activeTeamId !== null && !(state.teams ?? []).some((team) => team.id === activeTeamId)) {
          setActiveTeamId(null)
        }
      }, [activeTeamId, state.teams])

      React.useEffect(() => {
        if (activeTeamStorageKey === null || state.composition === null || restoredTeamFor.current === activeTeamStorageKey) return
        restoredTeamFor.current = activeTeamStorageKey
        try {
          const saved = window.localStorage?.getItem(activeTeamStorageKey)
          if (saved !== null && saved !== undefined && (state.teams ?? []).some((team) => team.id === saved)) {
            setActiveTeamId(saved)
          }
        } catch {
          // Storage can be disabled; the tab still works without a restored selection.
        }
      }, [activeTeamStorageKey, state.composition, state.teams])

      React.useEffect(() => {
        if (activeTeamStorageKey === null || restoredTeamFor.current !== activeTeamStorageKey) return
        try {
          if (activeTeamId === null) window.localStorage?.removeItem(activeTeamStorageKey)
          else window.localStorage?.setItem(activeTeamStorageKey, activeTeamId)
        } catch {
          // Best effort; a disabled localStorage must not break Team selection.
        }
      }, [activeTeamId, activeTeamStorageKey])

      const mutate = React.useCallback(async (action, successMessage) => {
        setBusy(true)
        setNotice(null)
        try {
          await action()
          await load({ silent: true })
          setNotice(successMessage ?? null)
          window.dispatchEvent(new CustomEvent(COMPOSITION_CHANGED, { detail: { sessionId } }))
          return true
        } catch (error) {
          setNotice(error.code === 'AGENT_BUSY' ? t('agentBusy') : error.message)
          return false
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

      const closePicker = () => setPicker((previous) => ({
        ...previous, open: false, query: '', parentId: '',
      }))

      const openPicker = async () => {
        setPicker((previous) => ({ ...previous, open: true }))
        try {
          const sessionData = await callApi('/sessions')
          setPicker((previous) => ({ ...previous, sessions: sessionData.sessions ?? [] }))
        } catch (error) {
          setNotice(error.message)
          return
        }
        // Native catalog discovery can walk a large tree; never block the
        // session picker on it. External leaves fill in asynchronously.
        try {
          const externalData = await callApi(`/external?rootSessionId=${encodeURIComponent(activeRoot)}`)
          setPicker((previous) => ({
            ...previous,
            external: externalData.leaves ?? [],
            externalAvailable: externalData.available === true,
          }))
        } catch (error) {
          setPicker((previous) => ({ ...previous, external: [], externalAvailable: false }))
        }
      }

      const addSession = async (session) => {
        const added = await mutate(
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
        if (added) closePicker()
      }

      const addExternal = async (leaf) => {
        const added = await mutate(
          () => callApi('/add-external', {
            method: 'POST',
            body: {
              rootSessionId: activeRoot,
              label: leaf.label,
              provider: leaf.mode,
              nativeParentSessionId: leaf.nativeParentSessionId,
              externalId: leaf.externalId,
              parentId: picker.parentId.length > 0 ? picker.parentId : null,
            },
          }),
          null,
        )
        if (added) closePicker()
      }

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

      const runClone = async (path, body, doneKey) => {
        let estimate = null
        try {
          const query = new URLSearchParams({ rootSessionId: body.rootSessionId })
          if (typeof body.nodeId === 'string') query.set('nodeId', body.nodeId)
          estimate = await callApi(`/clone-estimate?${query.toString()}`)
        } catch {
          // The estimate is advisory; the clone route still validates the plan.
        }
        setPendingClone({ path, body, doneKey, estimate })
      }

      const confirmClone = () => {
        const pending = pendingClone
        if (pending === null) return
        setPendingClone(null)
        setBusy(true)
        setNotice(null)
        callApi(pending.path, { method: 'POST', body: pending.body })
          .then((data) => {
            const newRoot = data?.clone?.newRootSessionId
            setNotice(format(t, pending.doneKey, { session: typeof newRoot === 'string' ? newRoot : t('none') }))
            if (typeof newRoot === 'string' && typeof openSession === 'function') openSession(newRoot)
          })
          .catch((error) => setNotice(error.code === 'AGENT_BUSY' ? t('agentBusy') : error.message))
          .finally(() => setBusy(false))
      }

      const cloneTree = () => { void runClone('/clone-tree', { rootSessionId: activeRoot }, 'cloneDone') }
      const budNode = (nodeId) => { void runClone('/bud', { rootSessionId: activeRoot, nodeId }, 'budDone') }

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

      const createTeam = async () => {
        if (teamLead.length === 0) return
        setBusy(true)
        setNotice(null)
        try {
          const data = await callApi('/create-team', {
            method: 'POST',
            body: { rootSessionId: activeRoot, rootNodeId: teamLead, nodeIds: teamSelected, label: teamLabel },
          })
          await load({ silent: true })
          const created = (data.teams ?? [])[(data.teams ?? []).length - 1]
          setActiveTeamId(created?.id ?? null)
          setTeamForm(false)
          setTeamLabel('')
          setTeamLead('')
          setTeamSelected([])
        } catch (error) {
          setNotice(error.message)
        } finally {
          setBusy(false)
        }
      }

      const deleteTeam = async () => {
        const teamId = activeTeamId
        setConfirmTeamDelete(false)
        if (teamId === null) return
        setBusy(true)
        setNotice(null)
        try {
          await callApi('/delete-team', {
            method: 'POST',
            body: { rootSessionId: activeRoot, teamId },
          })
          setActiveTeamId(null)
          await load({ silent: true })
        } catch (error) {
          setNotice(error.message)
        } finally {
          setBusy(false)
        }
      }

      const createTask = (subject, description, ownerNodeId) => mutate(
        () => callApi('/create-task', {
          method: 'POST',
          body: { rootSessionId: activeRoot, subject, description, ownerNodeId, teamId: activeTeamId },
        }),
        null,
      )

      const updateTask = (taskId, action, expectedRevision, ownerNodeId = undefined) => mutate(
        () => callApi('/update-task', {
          method: 'POST',
          body: {
            rootSessionId: activeRoot,
            taskId,
            action,
            expectedRevision,
            teamId: activeTeamId,
            ...(ownerNodeId === undefined ? {} : { ownerNodeId }),
          },
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

      const checkCleanup = async () => {
        setCleanup((previous) => ({ ...previous, loading: true, error: null, notice: null }))
        try {
          const data = await callApi('/session-cleanup')
          setCleanupContent({})
          setCleanupContentBusy(null)
          setCleanup((previous) => ({ ...previous, loading: false, data }))
        } catch (error) {
          setCleanup((previous) => ({ ...previous, loading: false, error: error.message }))
        }
      }

      const previewCleanupSession = async (sessionId) => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        setCleanupContentBusy(sessionId)
        try {
          const data = await callApi(`/session-cleanup/session?sessionId=${encodeURIComponent(sessionId)}`)
          setCleanupContent((previous) => ({ ...previous, [sessionId]: data }))
        } catch (error) {
          setCleanupContent((previous) => ({
            ...previous,
            [sessionId]: { error: error.message },
          }))
        } finally {
          setCleanupContentBusy(null)
        }
      }

      const runCleanup = async () => {
        const data = cleanup.data
        if (data === null) return
        setCleanupConfirm(false)
        setCleanup((previous) => ({ ...previous, busy: true, error: null, notice: null }))
        const sessionIds = [
          ...data.wild.map((entry) => entry.sessionId),
          ...(cleanup.includeLegacy ? data.legacy.map((entry) => entry.sessionId) : []),
        ]
        const oneShotNodeIds = data.oneShot.map((entry) => entry.nodeId)
        try {
          const result = await callApi('/session-cleanup', {
            method: 'POST',
            body: { sessionIds, oneShotNodeIds, includeLegacy: cleanup.includeLegacy },
          })
          await load({ silent: true })
          const fresh = await callApi('/session-cleanup')
          setCleanupContent({})
          setCleanupContentBusy(null)
          const removed = result.deleted.length + result.oneShotRemoved
          const done = format(t, 'cleanupDone', {
            count: String(removed),
            size: formatBytes(result.bytesFreed),
          })
          setCleanup({
            loading: false,
            busy: false,
            data: fresh,
            error: null,
            notice: result.failures.length === 0
              ? done
              : `${done} ${format(t, 'cleanupPartial', { count: String(result.failures.length) })}`,
            includeLegacy: false,
          })
        } catch (error) {
          setCleanup((previous) => ({ ...previous, busy: false, error: error.message }))
        }
      }

      const composition = state.composition
      const filteredComposition = React.useMemo(
        () => visibleComposition(composition, showOneShot),
        [composition, showOneShot],
      )
      const tree = React.useMemo(() => treeOf(filteredComposition), [filteredComposition])
      const nodes = filteredComposition?.nodes ?? []
      const teams = state.teams ?? []
      const activeTeam = activeTeamId === null ? null : teams.find((team) => team.id === activeTeamId) ?? null
      const teamMemberIds = (team) => {
        const composition = state.composition
        if (Array.isArray(team?.nodeIds) && team.nodeIds.length > 0) {
          return new Set(team.nodeIds.filter((id) => composition?.nodes?.some((node) => node.id === id)))
        }
        const root = composition?.nodes?.find((node) => node.id === team?.rootNodeId)
        if (root === undefined) return new Set()
        const children = new Map()
        for (const edge of composition.edges ?? []) {
          const list = children.get(edge.parentId) ?? []
          list.push(edge.childId)
          children.set(edge.parentId, list)
        }
        const memberIds = new Set()
        const queue = [root.id]
        while (queue.length > 0) {
          const id = queue.shift()
          if (memberIds.has(id)) continue
          memberIds.add(id)
          for (const childId of children.get(id) ?? []) queue.push(childId)
        }
        return memberIds
      }
      const activeTeamMemberIds = activeTeam === null ? null : teamMemberIds(activeTeam)
      const taskNodes = activeTeam === null
        ? nodes
        : nodes.filter((node) => activeTeamMemberIds.has(node.id) && node.mode !== 'one-shot')
      const visibleTasks = (state.tasks ?? []).filter((task) => activeTeamId === null
        ? task.teamId === null || task.teamId === undefined
        : task.teamId === activeTeamId)
      const teamLeadNodes = nodes.filter((node) => node.kind === 'session' && node.mode !== 'one-shot')
      const teamSelectableIds = new Set(teamLeadNodes.map((node) => node.id))
      const teamSubtreeSelection = (lead) => lead.length === 0
        ? []
        : [...teamMemberIds({ rootNodeId: lead })].filter((id) => teamSelectableIds.has(id))
      const cleanupTotals = cleanup.data?.totals ?? null
      const cleanupLegacyCount = cleanup.includeLegacy ? cleanupTotals?.legacy.count ?? 0 : 0
      const cleanupLegacyBytes = cleanup.includeLegacy ? cleanupTotals?.legacy.bytes ?? 0 : 0
      const cleanupCount = (cleanupTotals?.wild.count ?? 0) + cleanupLegacyCount + (cleanupTotals?.oneShot.count ?? 0)
      const cleanupBytes = (cleanupTotals?.wild.bytes ?? 0) + cleanupLegacyBytes + (cleanupTotals?.oneShot.bytes ?? 0)
      const cleanupAllBytes = (cleanupTotals?.wild.bytes ?? 0)
        + (cleanupTotals?.legacy.bytes ?? 0)
        + (cleanupTotals?.oneShot.bytes ?? 0)
      const cleanupAny = ((cleanupTotals?.wild.count ?? 0)
        + (cleanupTotals?.legacy.count ?? 0)
        + (cleanupTotals?.oneShot.count ?? 0)) > 0
      const cleanupList = (key, labelKey, entries) => entries.length === 0 ? null : h('div', {
        key,
        style: { display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' },
      }, [
        h('div', { key: 'label', style: styles.sessionMeta }, t(labelKey)),
        ...entries.slice(0, 5).map((entry) => {
          const content = entry.sessionId === undefined ? undefined : cleanupContent[entry.sessionId]
          return h('div', {
            key: entry.sessionId ?? entry.nodeId,
            style: { display: 'flex', flexDirection: 'column', gap: '2px' },
          }, [
            h('div', { key: 'line', style: { display: 'flex', alignItems: 'center', gap: '4px', ...styles.sessionMeta, overflowWrap: 'anywhere' } }, [
              h('span', { key: 'text' }, `${entry.title} · ${formatBytes(entry.size)}`),
              entry.sessionId === undefined
                ? null
                : h('button', {
                    key: 'preview',
                    type: 'button',
                    style: styles.linkButton,
                    disabled: cleanupContentBusy === entry.sessionId,
                    onClick: () => void previewCleanupSession(entry.sessionId),
                  }, cleanupContentBusy === entry.sessionId ? t('cleanupLoadingContent') : t('cleanupPreviewContent')),
            ]),
            content === undefined
              ? null
              : content.error !== undefined
                ? h('div', { key: 'content-error', style: styles.error }, `${t('cleanupContentFailed')} ${content.error}`)
                : content.firstUser === null && content.lastMessage === null
                  ? h('div', { key: 'content-empty', style: styles.sessionMeta }, t('cleanupNoContent'))
                  : h('div', { key: 'content', style: { ...styles.sessionMeta, overflowWrap: 'anywhere', whiteSpace: 'normal' } }, [
                      content.firstUser === null ? null : h('div', { key: 'first' }, `${t('cleanupFirstUser')}: ${content.firstUser}`),
                      content.lastMessage === null ? null : h('div', { key: 'last' }, `${t('cleanupLastMessage')}: ${content.lastMessage}`),
                    ]),
          ])
        }),
        entries.length > 5
          ? h('div', { key: 'more', style: styles.sessionMeta }, format(t, 'cleanupMore', { count: String(entries.length - 5) }))
          : null,
      ])

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
          composition === null
            ? null
            : h('label', {
                key: 'one-shot',
                style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' },
              }, [
                h('input', {
                  key: 'input',
                  type: 'checkbox',
                  checked: showOneShot,
                  onChange: (event) => setShowOneShot(event.target.checked),
                }),
                h('span', { key: 'label' }, t('showOneShot')),
              ]),
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
                composition: filteredComposition,
                observations: state.observations,
                t,
                setPendingRemove,
                busy,
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
                    onClose: closePicker,
                    t,
                  })
                : h('button', { key: 'open-picker', type: 'button', style: styles.button, disabled: busy, onClick: () => void openPicker() }, t('addSession')),
              h('div', { key: 'teams', style: styles.board }, [
                h('div', { key: 'title', style: styles.taskHeader }, [
                  h('span', { key: 'glyph', style: styles.taskGlyph, 'aria-hidden': true }, '◈'),
                  h('span', { key: 'label', style: styles.sectionTitle }, t('teams')),
                ]),
                h('div', { key: 'selector', style: styles.confirmRow }, [
                  h('select', {
                    key: 'select',
                    style: styles.select,
                    value: activeTeamId ?? '',
                    onChange: (event) => setActiveTeamId(event.target.value === '' ? null : event.target.value),
                  }, [
                    h('option', { key: 'composition', value: '' }, t('compositionBoard')),
                    ...teams.map((team) => h('option', { key: team.id, value: team.id }, team.label)),
                  ]),
                  activeTeam === null ? null : h('button', {
                    key: 'delete',
                    type: 'button',
                    style: styles.danger,
                    disabled: busy,
                    onClick: () => setConfirmTeamDelete(true),
                  }, t('deleteTeam')),
                  teamForm ? null : h('button', {
                    key: 'create',
                    type: 'button',
                    style: styles.button,
                    disabled: busy || teamLeadNodes.length === 0,
                    onClick: () => {
                      const lead = teamLead.length > 0 ? teamLead : (teamLeadNodes[0]?.id ?? '')
                      setTeamForm(true)
                      setTeamLead(lead)
                      setTeamSelected(teamSubtreeSelection(lead))
                    },
                  }, t('createTeam')),
                ]),
                activeTeam === null
                  ? h('div', { key: 'hint', style: styles.sessionMeta }, t('teamHint'))
                  : h('div', { key: 'hint', style: styles.sessionMeta }, `${activeTeam.label} · ${activeTeamMemberIds.size} ${t('teamMembers')}`),
                teamForm ? h('div', {
                  key: 'form',
                  style: styles.picker,
                  onKeyDown: (event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    event.stopPropagation()
                    setTeamForm(false)
                  },
                }, [
                  h('div', { key: 'header', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                    h('div', { key: 'title', style: { ...styles.sectionTitle, flex: '1 1 auto' } }, t('createTeam')),
                    h('button', { key: 'cancel', type: 'button', style: styles.linkButton, onClick: () => setTeamForm(false) }, t('cancel')),
                  ]),
                  h('div', { key: 'fields', style: styles.taskForm }, [
                    h('input', {
                      key: 'label',
                      style: styles.input,
                      placeholder: t('teamLabel'),
                      value: teamLabel,
                      onChange: (event) => setTeamLabel(event.target.value),
                    }),
                    h('select', {
                      key: 'lead',
                      style: styles.select,
                      value: teamLead,
                      onChange: (event) => {
                        const lead = event.target.value
                        setTeamLead(lead)
                        setTeamSelected(teamSubtreeSelection(lead))
                      },
                    }, teamLeadNodes.map((node) => h('option', { key: node.id, value: node.id }, node.label))),
                    h('button', {
                      key: 'create',
                      type: 'button',
                      style: styles.button,
                      disabled: busy || teamLead.length === 0 || !teamSelected.includes(teamLead),
                      onClick: () => void createTeam(),
                    }, t('createTeam')),
                  ]),
                  h('div', { key: 'members', style: styles.results }, teamLeadNodes.map((node) => h('label', {
                    key: node.id,
                    style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' },
                  }, [
                    h('input', {
                      key: 'input',
                      type: 'checkbox',
                      checked: teamSelected.includes(node.id),
                      onChange: (event) => setTeamSelected((previous) => event.target.checked
                        ? [...new Set([...previous, node.id])]
                        : previous.filter((id) => id !== node.id)),
                    }),
                    h('span', { key: 'label' }, node.label),
                  ]))),
                  h('div', { key: 'hint', style: styles.sessionMeta }, t('teamHint')),
                ]) : null,
              ]),
              h(TaskBoard, {
                key: 'tasks',
                tasks: visibleTasks,
                nodes: taskNodes,
                busy,
                t,
                onCreate: createTask,
                onUpdate: updateTask,
              }),
              h('div', { key: 'cleanup', style: styles.board }, [
                h('div', { key: 'title', style: styles.sectionTitle }, t('cleanup')),
                h('div', { key: 'hint', style: styles.sessionMeta }, t('cleanupHint')),
                h('div', { key: 'actions', style: styles.confirmRow }, [
                  h('button', {
                    key: 'check',
                    type: 'button',
                    style: styles.button,
                    disabled: busy || cleanup.loading || cleanup.busy,
                    onClick: () => void checkCleanup(),
                  }, cleanup.loading ? t('cleanupChecking') : t('cleanupCheck')),
                  cleanup.data !== null && cleanup.data.available === true && cleanupCount > 0
                    ? h('button', {
                        key: 'delete',
                        type: 'button',
                        style: styles.danger,
                        disabled: busy || cleanup.loading || cleanup.busy,
                        onClick: () => setCleanupConfirm(true),
                      }, t('cleanupDelete'))
                    : null,
                ]),
                cleanup.busy ? h('div', { key: 'busy', style: styles.sessionMeta }, t('cleanupDeleting')) : null,
                cleanup.error === null ? null : h('div', { key: 'error', style: styles.error }, `${t('cleanupCheckFailed')} ${cleanup.error}`),
                cleanup.notice === null ? null : h('div', { key: 'notice', style: styles.notice }, cleanup.notice),
                cleanup.data === null
                  ? null
                  : cleanup.data.available !== true
                    ? h('div', { key: 'unavailable', style: styles.warning }, t('cleanupUnavailable'))
                    : h('div', { key: 'result', style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
                        h('div', { key: 'summary', style: styles.sessionMeta }, cleanupAny === false
                          ? t('cleanupNone')
                          : format(t, 'cleanupSummary', {
                              wild: String(cleanup.data.totals.wild.count),
                              legacy: String(cleanup.data.totals.legacy.count),
                              oneShot: String(cleanup.data.totals.oneShot.count),
                              size: formatBytes(cleanupAllBytes),
                            })),
                        cleanup.data.totals.legacy.count > 0
                          ? h('label', {
                              key: 'legacy',
                              style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' },
                            }, [
                              h('input', {
                                key: 'input',
                                type: 'checkbox',
                                checked: cleanup.includeLegacy,
                                onChange: (event) => setCleanup((previous) => ({ ...previous, includeLegacy: event.target.checked })),
                              }),
                              h('span', { key: 'label' }, t('cleanupLegacyOption')),
                            ])
                          : null,
                        cleanupList('wild', 'cleanupWild', cleanup.data.wild),
                        cleanupList('legacy-list', 'cleanupLegacy', cleanup.data.legacy),
                        cleanupList('one-shot-list', 'cleanupOneShot', cleanup.data.oneShot),
                      ]),
              ]),
              h('button', {
                key: 'delete',
                type: 'button',
                style: styles.linkButton,
                disabled: busy,
                onClick: () => setConfirmDelete(true),
              }, t('deleteComposition')),
              pendingRemove === null ? null : h(ConfirmDialog, {
                key: 'remove-dialog',
                title: t('removeTitle'),
                message: format(t, 'removePrompt', { label: pendingRemove.label }),
                confirmLabel: t('promote'),
                secondaryLabel: t('cascade'),
                secondaryDanger: true,
                cancelLabel: t('cancel'),
                busy,
                onCancel: () => setPendingRemove(null),
                onConfirm: () => removeNode('promote'),
                onSecondary: () => removeNode('cascade'),
              }),
              confirmDelete ? h(ConfirmDialog, {
                key: 'delete-dialog',
                title: t('deleteComposition'),
                message: t('deleteConfirm'),
                confirmLabel: t('confirmDelete'),
                cancelLabel: t('cancel'),
                danger: true,
                busy,
                onCancel: () => setConfirmDelete(false),
                onConfirm: deleteComposition,
              }) : null,
              pendingClone === null ? null : h(ConfirmDialog, {
                key: 'clone-dialog',
                title: pendingClone.path === '/clone-tree' ? t('cloneTree') : t('bud'),
                message: `${t(pendingClone.path === '/clone-tree' ? 'cloneTreeConfirm' : 'budConfirm')}${
                  pendingClone.estimate === null
                    ? ''
                    : ` ${format(t, 'cloneEstimate', {
                        sessions: String(pendingClone.estimate.sessions),
                        size: formatBytes(pendingClone.estimate.bytes),
                      })}`
                }`,
                confirmLabel: pendingClone.path === '/clone-tree' ? t('cloneTree') : t('bud'),
                cancelLabel: t('cancel'),
                busy,
                onCancel: () => setPendingClone(null),
                onConfirm: confirmClone,
              }),
              confirmTeamDelete ? h(ConfirmDialog, {
                key: 'team-delete-dialog',
                title: t('deleteTeam'),
                message: t('teamDeleteConfirm'),
                confirmLabel: t('deleteTeam'),
                cancelLabel: t('cancel'),
                danger: true,
                busy,
                onCancel: () => setConfirmTeamDelete(false),
                onConfirm: () => void deleteTeam(),
              }) : null,
              cleanupConfirm ? h(ConfirmDialog, {
                key: 'cleanup-dialog',
                title: t('cleanup'),
                message: format(t, 'cleanupConfirm', {
                  count: String(cleanupCount),
                  size: formatBytes(cleanupBytes),
                }),
                confirmLabel: t('cleanupDelete'),
                cancelLabel: t('cancel'),
                danger: true,
                busy: cleanup.busy,
                onCancel: () => setCleanupConfirm(false),
                onConfirm: runCleanup,
              }) : null,
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
        const loadSummary = () => {
          callApi(`/summary?sessionId=${encodeURIComponent(sessionId)}`)
            .then((data) => { if (!cancelled) setSummary(data) })
            .catch(() => { if (!cancelled) setSummary(null) })
        }
        loadSummary()
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') loadSummary()
        }, 5000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
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
