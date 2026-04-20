import { DefaultSidebar, Sidebar, THEME } from "@excalidraw/excalidraw";
import {
  gridIcon,
  presentationIcon,
  sidebarRightIcon,
  usersIcon,
} from "@excalidraw/excalidraw/components/icons";
import { LinkButton } from "@excalidraw/excalidraw/components/LinkButton";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";
import { useEffect, useState } from "react";

import { MY_DIAGRAMS_TAB, MyDiagramsPanel } from "./MyDiagramsPanel";
import { USERS_TAB, UsersPanel } from "./UsersPanel";

import "./AppSidebar.scss";

const LAST_SIDEBAR_TAB_KEY = "excalidraw-last-sidebar-tab";

const VALID_TABS = new Set<string>([
  MY_DIAGRAMS_TAB,
  USERS_TAB,
  "presentation",
]);

const readLastTab = (): string => {
  try {
    const stored = localStorage.getItem(LAST_SIDEBAR_TAB_KEY);
    if (stored && VALID_TABS.has(stored)) {
      return stored;
    }
    return MY_DIAGRAMS_TAB;
  } catch {
    return MY_DIAGRAMS_TAB;
  }
};

export const AppSidebar = () => {
  const { theme, openSidebar } = useUIAppState();
  const [lastTab, setLastTab] = useState<string>(readLastTab);

  useEffect(() => {
    if (
      openSidebar?.name === DEFAULT_SIDEBAR.name &&
      openSidebar.tab &&
      openSidebar.tab !== CANVAS_SEARCH_TAB &&
      openSidebar.tab !== lastTab
    ) {
      setLastTab(openSidebar.tab);
      try {
        localStorage.setItem(LAST_SIDEBAR_TAB_KEY, openSidebar.tab);
      } catch {
        // ignore
      }
    }
  }, [openSidebar, lastTab]);

  return (
    <>
      <DefaultSidebar.Trigger
        icon={sidebarRightIcon}
        title="Toggle sidebar"
        tab={lastTab}
      />
      <DefaultSidebar>
        <DefaultSidebar.TabTriggers>
          <Sidebar.TabTrigger
            tab={MY_DIAGRAMS_TAB}
            style={{ opacity: openSidebar?.tab === MY_DIAGRAMS_TAB ? 1 : 0.4 }}
            title="My diagrams"
          >
            {gridIcon}
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab={USERS_TAB}
            style={{ opacity: openSidebar?.tab === USERS_TAB ? 1 : 0.4 }}
            title="Users"
          >
            {usersIcon}
          </Sidebar.TabTrigger>
          <Sidebar.TabTrigger
            tab="presentation"
            style={{ opacity: openSidebar?.tab === "presentation" ? 1 : 0.4 }}
          >
            {presentationIcon}
          </Sidebar.TabTrigger>
        </DefaultSidebar.TabTriggers>
        <Sidebar.Tab tab={MY_DIAGRAMS_TAB}>
          <MyDiagramsPanel />
        </Sidebar.Tab>
        <Sidebar.Tab tab={USERS_TAB}>
          <UsersPanel />
        </Sidebar.Tab>
        <Sidebar.Tab tab="presentation" className="px-3">
          <div className="app-sidebar-promo-container">
            <div
              className="app-sidebar-promo-image"
              style={{
                ["--image-source" as any]: `url(/oss_promo_presentations_${
                  theme === THEME.DARK ? "dark" : "light"
                }.svg)`,
                backgroundSize: "60%",
                opacity: 0.4,
              }}
            />
            <div className="app-sidebar-promo-text">
              Create presentations with Excalidraw+
            </div>
            <LinkButton
              href={`${
                import.meta.env.VITE_APP_PLUS_LP
              }/plus?utm_source=excalidraw&utm_medium=app&utm_content=presentations_promo#excalidraw-redirect`}
            >
              Sign up now
            </LinkButton>
          </div>
        </Sidebar.Tab>
      </DefaultSidebar>
    </>
  );
};
