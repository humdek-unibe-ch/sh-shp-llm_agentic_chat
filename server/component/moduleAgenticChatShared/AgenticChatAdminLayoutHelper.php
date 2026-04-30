<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Builds sidebar menu data for the unified Agentic Chat admin layout.
 *
 * Each module view calls this helper to render the shared shell with the
 * correct active state and ACL-based visibility, mirroring the
 * LlmAdminLayoutHelper pattern from sh-shp-llm.
 */
class AgenticChatAdminLayoutHelper
{
    /** @var array Default menu definitions (keyword + icon + fallback label). */
    private static $menuDefinitions = [
        [
            'keyword' => 'sh_module_llm_agentic_chat',
            'icon' => 'fa-cog',
            'fallbackLabel' => 'Configuration',
        ],
        [
            'keyword' => 'sh_module_llm_agentic_chat_threads',
            'icon' => 'fa-comments',
            'fallbackLabel' => 'Threads',
        ],
    ];

    /**
     * Resolve sidebar menu items with URLs, ACL flags, and active state.
     *
     * @param object $services       SelfHelp service container.
     * @param string $activeKeyword  Page keyword of the currently active tab.
     * @return array  Menu items ready for the layout template.
     */
    public static function getMenuItems($services, $activeKeyword)
    {
        $db = $services->get_db();
        $acl = $services->get_acl();
        $router = $services->get_router();
        $userId = $_SESSION['id_user'] ?? null;
        $langId = $_SESSION['user_language'] ?? 2;
        $defaultLangId = $_SESSION['language'] ?? 2;

        $items = [];
        foreach (self::$menuDefinitions as $def) {
            $pageId = $db->fetch_page_id_by_keyword($def['keyword']);
            $url = $router->get_link_url($def['keyword']);

            $hasAccess = false;
            if ($pageId && $userId) {
                $hasAccess = $acl->has_access_select($userId, $pageId);
            }

            $label = self::resolvePageTitle($db, $pageId, $langId, $defaultLangId);
            if (!$label) {
                $label = $def['fallbackLabel'];
            }

            $items[] = [
                'keyword' => $def['keyword'],
                'label' => $label,
                'icon' => $def['icon'],
                'url' => $url,
                'active' => ($def['keyword'] === $activeKeyword),
                'hasAccess' => $hasAccess,
                'pageId' => $pageId,
            ];
        }

        return $items;
    }

    /**
     * Load translated page title from pages_fields_translation.
     */
    private static function resolvePageTitle($db, $pageId, $langId, $defaultLangId)
    {
        if (!$pageId) {
            return null;
        }
        try {
            $row = $db->query_db_first(
                "SELECT pft.content
                   FROM pages_fields_translation pft
             INNER JOIN fields f ON f.id = pft.id_fields
                  WHERE pft.id_pages = ? AND f.name = 'title'
                    AND pft.id_languages IN (?, ?)
               ORDER BY CASE WHEN pft.id_languages = ? THEN 0 ELSE 1 END
                  LIMIT 1",
                [$pageId, $langId, $defaultLangId, $langId]
            );
            return $row ? $row['content'] : null;
        } catch (Exception $e) {
            return null;
        }
    }

    /**
     * Path to the shared layout template.
     *
     * @return string Absolute path to llm_agentic_chat_admin_layout.php.
     */
    public static function getLayoutTemplatePath()
    {
        return __DIR__ . '/tpl/llm_agentic_chat_admin_layout.php';
    }
}
