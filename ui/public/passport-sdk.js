(function () {
  if (window.PassportSDK) return;

  const styleId = 'passport-sdk-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
      .passport-launcher {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #1e3320; /* forest green */
        color: #f4f1ea; /* cream */
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.2s;
        border: 2px solid #ddd8cc;
      }
      .passport-launcher:hover {
        transform: scale(1.08);
        background: #2a472d;
      }
      .passport-launcher svg {
        width: 24px;
        height: 24px;
        fill: currentColor;
      }
      .passport-drawer-container {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        top: 0;
        z-index: 99998;
        display: none;
        pointer-events: none;
        transition: background 0.3s ease;
      }
      .passport-drawer-container.open {
        display: block;
        pointer-events: auto;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
      }
      .passport-iframe-wrapper {
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translate(-50%, 100%);
        width: 100%;
        max-width: 480px;
        height: 100vh;
        background: #f4f1ea;
        border-radius: 0;
        overflow: hidden;
        box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.25);
        transition: transform 0.3s cubic-bezier(0.32, 0.94, 0.6, 1);
      }
      .passport-drawer-container.open .passport-iframe-wrapper {
        transform: translate(-50%, 0);
      }
      .passport-iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
      @media (min-width: 768px) {
        .passport-iframe-wrapper {
          top: 0;
          bottom: 0;
          right: 0;
          left: auto;
          transform: translate(100%, 0);
          width: 420px;
          max-width: 100%;
          height: 100vh;
          border-top-left-radius: 16px;
          border-bottom-left-radius: 16px;
          border-top-right-radius: 0;
        }
        .passport-drawer-container.open .passport-iframe-wrapper {
          transform: translate(0, 0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  const PassportSDK = {
    config: {
      baseUrl: window.location.origin,
      position: 'bottom-right'
    },
    isOpen: false,
    elements: {},

    isInternalDomain() {
      const host = window.location.hostname;
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.endsWith('.lakeandlocals.com') ||
        host === 'lakeandlocals.com' ||
        host.endsWith('.krowdkraft.com') ||
        host === 'krowdkraft.com' ||
        host.endsWith('.pages.dev')
      );
    },

    init(options = {}) {
      if (!this.isInternalDomain()) {
        console.warn('PassportSDK: Blocked initialization. Host domain is not authorized for internal application use.');
        return;
      }

      if (options.baseUrl) this.config.baseUrl = options.baseUrl;
      
      this.createLauncher();
      this.createDrawer();
      this.setupListeners();
    },

    createLauncher() {
      if (document.querySelector('.passport-launcher')) return;

      const launcher = document.createElement('div');
      launcher.className = 'passport-launcher';
      launcher.setAttribute('aria-label', 'Open Passport Explorer');
      
      // A premium passport stamp/ticket looking icon
      launcher.innerHTML = `
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
          <line x1="4" y1="22" x2="4" y2="15"></line>
        </svg>
      `;

      launcher.addEventListener('click', () => this.toggle());
      document.body.appendChild(launcher);
      this.elements.launcher = launcher;
    },

    createDrawer() {
      if (document.querySelector('.passport-drawer-container')) return;

      const container = document.createElement('div');
      container.className = 'passport-drawer-container';

      const wrapper = document.createElement('div');
      wrapper.className = 'passport-iframe-wrapper';

      const iframe = document.createElement('iframe');
      iframe.className = 'passport-iframe';
      // Load about:blank initially to prevent background CPU/memory overhead when closed
      iframe.src = 'about:blank';
      iframe.setAttribute('title', 'My Passport Drawer');
      iframe.setAttribute('allow', 'geolocation');

      wrapper.appendChild(iframe);
      container.appendChild(wrapper);

      // Close when clicking on backdrop overlay
      container.addEventListener('click', (e) => {
        if (e.target === container) {
          this.close();
        }
      });

      document.body.appendChild(container);
      this.elements.container = container;
      this.elements.iframe = iframe;
    },

    setupListeners() {
      window.addEventListener('message', (event) => {
        // Handle cross-origin actions from the iframe drawer
        if (event.data && event.data.type === 'CLOSE_PASSPORT_DRAWER') {
          this.close();
        }
      });
    },

    open() {
      if (this.isOpen) return;
      this.isOpen = true;

      // Dynamically load React client on demand when opened
      if (this.elements.iframe) {
        this.elements.iframe.src = `${this.config.baseUrl}/embed/drawer`;
      }

      this.elements.container.classList.add('open');
      document.body.style.overflow = 'hidden';
    },

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.elements.container.classList.remove('open');
      document.body.style.overflow = '';

      // Completely unload the iframe to free 100% of background memory and CPU immediately!
      if (this.elements.iframe) {
        this.elements.iframe.src = 'about:blank';
      }
    },

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }
  };

  window.PassportSDK = PassportSDK;
})();
