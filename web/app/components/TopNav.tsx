import { NavLink, useLocation } from "@remix-run/react";
import ThemeToggle from "./ThemeToggle";

export default function TopNav() {
  const linkBase =
    "px-3 py-1.5 text-sm font-medium rounded transition-colors";
  const activeClass =
    "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white";
  const inactiveClass =
    "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white";

  const location = useLocation();
  const inRequests = location.pathname.startsWith("/requests");
  const inConversations = location.pathname.startsWith("/conversations");

  const handleKeepCurrent =
    (active: boolean) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (active) e.preventDefault();
    };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 dark:bg-slate-900 dark:border-slate-700">
      <div className="w-full px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Claude Code Monitor
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <nav className="inline-flex items-center bg-gray-100 dark:bg-slate-800 rounded p-0.5 space-x-0.5">
            <NavLink
              to="/requests"
              onClick={handleKeepCurrent(inRequests)}
              className={({ isActive }) =>
                `${linkBase} ${isActive ? activeClass : inactiveClass}`
              }
            >
              Requests
            </NavLink>
            <NavLink
              to="/conversations"
              onClick={handleKeepCurrent(inConversations)}
              className={({ isActive }) =>
                `${linkBase} ${isActive ? activeClass : inactiveClass}`
              }
            >
              Conversations
            </NavLink>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
