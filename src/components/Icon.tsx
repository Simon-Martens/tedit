export type IconName =
  | 'open' | 'save' | 'download' | 'file' | 'plus' | 'minus' | 'close' | 'expand' | 'collapse'
  | 'previous' | 'next' | 'zoomIn' | 'zoomOut' | 'fitWidth' | 'fitPage' | 'rotate' | 'print'
  | 'settings' | 'search' | 'replace' | 'undo' | 'redo' | 'help'

export function Icon({ name }: { name: IconName }) {
  const paths = {
    open: <path d="M3 7.5h6l1.8 2H21l-2.4 8.5a2 2 0 0 1-1.9 1.5H5.2A2.2 2.2 0 0 1 3 17.3V7.5Zm0 0V5.8A1.8 1.8 0 0 1 4.8 4h4.7l2 2H18a2 2 0 0 1 2 2v1.5" />,
    save: <path d="M5 3.5h12l2.5 2.6v14.4h-15v-17Zm3 0v5h8v-5M8 20v-7h8v7" />,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 19.5h16" />,
    file: <path d="M6 3.5h8l4 4v13H6v-17Zm8 0v4h4M9 12h6m-6 4h6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    expand: <path d="M7 10h10M7 14h10M5 7h14v10H5z" />,
    collapse: <path d="M7 12h10M5 7h14v10H5z" />,
    previous: <path d="m14.5 7-5 5 5 5" />,
    next: <path d="m9.5 7 5 5-5 5" />,
    zoomIn: <path d="M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm4 9.5L19 19m-8.5-11v5m-2.5-2.5h5" />,
    zoomOut: <path d="M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm4 9.5L19 19m-6-4.5 4.5 4.5M8 10.5h5" />,
    fitWidth: <path d="M4 7v10m16-10v10M7 12h10m-8-2-2 2 2 2m6-4 2 2-2 2" />,
    fitPage: <path d="M6 3.5h12v17H6zM9 7h6m-6 3h6" />,
    rotate: <path d="M19 8V4m0 0h-4m4 0-3 3a7 7 0 1 0 1.5 7.5" />,
    print: <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z" />,
    settings: <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2m0 14.6v2.2M2.5 12h2.2m14.6 0h2.2M5.28 5.28l1.55 1.55m10.34 10.34 1.55 1.55M18.72 5.28l-1.55 1.55M6.83 17.17l-1.55 1.55M12 4.7a7.3 7.3 0 1 1 0 14.6 7.3 7.3 0 0 1 0-14.6Z" />
    </>,
    search: <path d="M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm4.3 10.3L20 20" />,
    replace: <path d="M4 7h13m-3-3 3 3-3 3m6 7H7m3-3-3 3 3 3" />,
    undo: <path d="M9 7 5 11l4 4m-4-4h8a6 6 0 0 1 6 6" />,
    redo: <path d="m15 7 4 4-4 4m4-4h-8a6 6 0 0 0-6 6" />,
    help: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.3-11.7A2.5 2.5 0 0 1 12.2 7c1.5 0 2.7.9 2.7 2.3 0 1.8-1.5 2.2-2.4 3-.5.4-.6.8-.6 1.4M12 17h.01" />,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  )
}
