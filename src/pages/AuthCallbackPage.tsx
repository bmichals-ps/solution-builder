import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * OAuth Callback Page
 * Handles redirects from:
 * 1. Supabase OAuth (Google, etc.) - uses URL hash with access_token
 * 2. Composio OAuth - uses URL params with code, opened in popup
 */
export function AuthCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      // Check for error in URL params
      const params = new URLSearchParams(window.location.search);
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      
      if (error) {
        setErrorMessage(errorDescription || error);
        setStatus('error');
        return;
      }

      // Check if this is a Supabase OAuth callback (has hash with access_token)
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      
      if (accessToken) {
        // Supabase OAuth callback - session is automatically handled by Supabase client
        // Just wait a moment for the session to be established, then redirect to home
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            throw sessionError;
          }
          
          if (session) {
            setStatus('success');
            // Redirect to home after a brief delay
            setTimeout(() => {
              window.location.href = '/';
            }, 1500);
            return;
          }
        } catch (e: any) {
          setErrorMessage(e.message || 'Failed to establish session');
          setStatus('error');
          return;
        }
      }

      // Check for Composio OAuth code (popup flow)
      const code = params.get('code');
      if (code) {
        // Composio popup flow - parent window handles this
        setStatus('success');
        setTimeout(() => {
          window.close();
        }, 2000);
        return;
      }

      // No tokens or codes found - redirect to home
      window.location.href = '/';
    };

    handleCallback();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-8">
      <div className="text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-16 h-16 text-[#6366f1] mx-auto mb-4 animate-spin" />
            <h1 className="text-xl font-semibold text-white mb-2">Completing sign in...</h1>
            <p className="text-sm text-[#6a6a75]">Please wait while we verify your credentials.</p>
          </>
        )}
        
        {status === 'error' && (
          <>
            <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">Authentication Failed</h1>
            <p className="text-sm text-[#6a6a75] mb-4">{errorMessage}</p>
            <a 
              href="/" 
              className="inline-block px-4 py-2 bg-[#6366f1] text-white rounded-lg hover:bg-[#5558e3] transition-colors"
            >
              Try Again
            </a>
          </>
        )}
        
        {status === 'success' && (
          <>
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">Signed in successfully!</h1>
            <p className="text-sm text-[#6a6a75]">Redirecting...</p>
          </>
        )}
      </div>
    </div>
  );
}
