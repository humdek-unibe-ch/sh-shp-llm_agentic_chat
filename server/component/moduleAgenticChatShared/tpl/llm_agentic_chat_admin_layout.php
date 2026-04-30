<?php
/**
 * Shared admin layout for all LLM Agentic Chat module pages.
 *
 * Expected variables:
 *   $menuItems    - array from AgenticChatAdminLayoutHelper::getMenuItems()
 *   $pageContent  - string of HTML to render in the content area
 */
?>
<div class="agentic-admin-wrapper">
    <nav class="agentic-admin-sidebar" aria-label="Agentic Chat Administration">
        <div class="agentic-admin-sidebar-header">
            <i class="fa fa-robot mr-2"></i>
            <span>Agentic Chat</span>
        </div>
        <ul class="agentic-admin-nav">
            <?php foreach ($menuItems as $item): ?>
            <li class="agentic-admin-nav-item<?php echo $item['active'] ? ' active' : ''; ?><?php echo !$item['hasAccess'] ? ' disabled' : ''; ?>">
                <?php if ($item['hasAccess']): ?>
                <a href="<?php echo htmlspecialchars($item['url']); ?>" class="agentic-admin-nav-link">
                    <i class="fa <?php echo htmlspecialchars($item['icon']); ?>"></i>
                    <span><?php echo htmlspecialchars($item['label']); ?></span>
                </a>
                <?php else: ?>
                <span class="agentic-admin-nav-link" title="You do not have permission to access this section">
                    <i class="fa <?php echo htmlspecialchars($item['icon']); ?>"></i>
                    <span><?php echo htmlspecialchars($item['label']); ?></span>
                    <i class="fa fa-lock agentic-admin-lock-icon"></i>
                </span>
                <?php endif; ?>
            </li>
            <?php endforeach; ?>
        </ul>
    </nav>
    <main class="agentic-admin-content">
        <?php echo $pageContent; ?>
    </main>
</div>
