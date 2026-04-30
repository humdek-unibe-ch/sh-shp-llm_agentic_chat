<?php /* React mount point for the agenticChat style. */ ?>
<div class="agentic-chat-root"
     data-user-id="<?php echo (int)$userId; ?>"
     data-section-id="<?php echo (int)$sectionId; ?>"
     data-config="<?php echo htmlspecialchars($this->getReactConfig(), ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?>">
    <div class="agentic-chat-loading p-3 text-muted">
        <i class="fa fa-spinner fa-spin mr-2"></i>
        Loading agentic chat&hellip;
    </div>
</div>
