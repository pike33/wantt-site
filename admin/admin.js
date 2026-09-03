(() => {
  const API_BASE = 'https://api.wantt.io';

  const loading = document.getElementById('loading');
  const signedOut = document.getElementById('signed-out');
  const signedIn = document.getElementById('signed-in');
  const authError = document.getElementById('auth-error');
  const identity = document.getElementById('identity');
  const signoutButton = document.getElementById('signout');

  const show = (target) => {
    loading.hidden = target !== loading;
    signedOut.hidden = target !== signedOut;
    signedIn.hidden = target !== signedIn;
  };

  const api = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const body = await response.json().catch(() => ({}));
    return { response, body };
  };

  const showSignedIn = (session) => {
    identity.textContent = session.email ? `Signed in as ${session.email}` : 'Signed in';
    show(signedIn);
  };

  const showError = (message) => {
    authError.textContent = message;
    authError.hidden = false;
  };

  const waitForGoogle = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.id) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > 10000) {
        window.clearInterval(timer);
        reject(new Error('Google Sign-In did not load.'));
      }
    }, 50);
  });

  const initializeGoogle = async (clientId) => {
    await waitForGoogle();

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        authError.hidden = true;

        try {
          const { response, body } = await api('/admin/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ credential }),
          });

          if (!response.ok) {
            showError(
              response.status === 403
                ? 'This Google account is not authorised for Wantt Admin.'
                : 'Sign-in failed. Please try again.'
            );
            return;
          }

          showSignedIn(body);
        } catch {
          showError('Could not reach the Wantt API. Please try again.');
        }
      },
      hd: 'wantt.io',
      use_fedcm_for_prompt: true,
    });

    window.google.accounts.id.renderButton(
      document.getElementById('google-signin'),
      {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        width: 280,
      }
    );
  };

  const boot = async () => {
    try {
      const session = await api('/admin/api/session');

      if (session.response.ok && session.body.authenticated) {
        showSignedIn(session.body);
        return;
      }

      const config = await api('/admin/api/config');
      if (!config.response.ok || !config.body.googleClientId) {
        throw new Error('Admin auth configuration is unavailable.');
      }

      show(signedOut);
      await initializeGoogle(config.body.googleClientId);
    } catch (error) {
      show(signedOut);
      showError(error instanceof Error ? error.message : 'Admin sign-in is unavailable.');
    }
  };

  signoutButton.addEventListener('click', async () => {
    try {
      await api('/admin/api/signout', { method: 'POST', body: '{}' });
    } finally {
      window.location.reload();
    }
  });

  boot();
})();
