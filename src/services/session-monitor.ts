/**
 * Session Monitor Service
 * 
 * Creates and monitors a "shadow" chat session using the Engagement API
 * to track what's happening in the bot conversation.
 * 
 * This allows us to provide context to the editor chatbot about
 * where the user is in the conversation and what the bot is doing.
 */

import type { ConversationMessage } from '../types';

const ENGAGEMENT_API_SANDBOX = 'https://engagement-api-sandbox.pypestream.com';
const ENGAGEMENT_API_LIVE = 'https://engagement-api.pypestream.com';

interface SessionInfo {
  chatId: string;
  userId: string;
  accessToken: string;
  pypeId: string;
  streamId: string;
}

export class SessionMonitor {
  private session: SessionInfo | null = null;
  private widgetId: string = '';
  private pollInterval: number = 2000; // 2 seconds
  private pollTimer: NodeJS.Timeout | null = null;
  private lastMessageCount: number = 0;
  private environment: 'sandbox' | 'live' = 'sandbox';
  private onMessageCallback: ((messages: ConversationMessage[]) => void) | null = null;
  
  private get apiBase(): string {
    return this.environment === 'sandbox' 
      ? ENGAGEMENT_API_SANDBOX 
      : ENGAGEMENT_API_LIVE;
  }
  
  /**
   * Create a new anonymous session with the widget
   */
  async createSession(widgetId: string): Promise<void> {
    this.widgetId = widgetId;
    this.lastMessageCount = 0;
    
    try {
      // Step 1: Create anonymous session
      const deviceId = `live-edit-monitor-${Date.now()}`;
      const sessionRes = await fetch(`${this.apiBase}/messaging/v1/consumers/anonymous_session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: widgetId,
          app_type: 'consumer',
          device_id: deviceId,
          device_type: 'web',
          platform: 'Mac OS X',
          browser_language: 'en-US',
          referring_site: 'https://live-edit.pypestream.com',
          user_browser: 'Live Edit Monitor'
        })
      });
      
      if (!sessionRes.ok) {
        throw new Error(`Failed to create session: ${sessionRes.status}`);
      }
      
      const sessionData = await sessionRes.json();
      
      this.session = {
        chatId: sessionData.chat_id,
        userId: sessionData.id,
        accessToken: sessionData.access_token,
        pypeId: sessionData.web_chat_pype_id,
        streamId: sessionData.web_chat_stream_id
      };
      
      console.log('[SessionMonitor] Session created:', this.session.chatId);
      
      // Step 2: Start the chat
      const startRes = await fetch(`${this.apiBase}/messaging/v1/chats/${this.session.chatId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.session.accessToken}`
        },
        body: JSON.stringify({
          app_id: widgetId,
          consumer: `consumer_${this.session.userId}`,
          gateway: 'pypestream_widget',
          pype_id: this.session.pypeId,
          stream_id: this.session.streamId,
          user_id: this.session.userId,
          version: '1'
        })
      });
      
      if (!startRes.ok) {
        console.warn('[SessionMonitor] Failed to start chat:', startRes.status);
      }
      
      console.log('[SessionMonitor] Chat started');
      
    } catch (error) {
      console.error('[SessionMonitor] Failed to create session:', error);
      throw error;
    }
  }
  
  /**
   * Start polling for new messages
   */
  startPolling(onMessage: (messages: ConversationMessage[]) => void): void {
    this.onMessageCallback = onMessage;
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    
    // Initial poll
    this.pollMessages();
    
    // Set up interval
    this.pollTimer = setInterval(() => {
      this.pollMessages();
    }, this.pollInterval);
    
    console.log('[SessionMonitor] Polling started');
  }
  
  /**
   * Poll for messages and notify callback if there are new ones
   */
  private async pollMessages(): Promise<void> {
    if (!this.session) return;
    
    try {
      const snapshotRes = await fetch(
        `${this.apiBase}/messaging/v1/chats/${this.session.chatId}/snapshot`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.session.accessToken}`
          },
          body: JSON.stringify({})
        }
      );
      
      if (!snapshotRes.ok) {
        // Session might have ended
        if (snapshotRes.status === 500 || snapshotRes.status === 404) {
          console.warn('[SessionMonitor] Session may have ended');
        }
        return;
      }
      
      const snapshot = await snapshotRes.json();
      const rawMessages = snapshot?.result?.messages || [];
      
      // Convert to our message format
      const messages: ConversationMessage[] = rawMessages.map((msg: any, index: number) => ({
        id: msg.id || `msg-${index}`,
        text: msg.msg || msg.message || '',
        fromSide: msg.side === 'bot' || msg.type === 'bot' ? 'bot' : 'user',
        timestamp: new Date(msg.timestamp || Date.now()),
        richAssetType: msg.rich_asset_type,
        richAssetContent: msg.rich_asset_content
      }));
      
      // Check if there are new messages
      if (messages.length !== this.lastMessageCount) {
        this.lastMessageCount = messages.length;
        this.onMessageCallback?.(messages);
      }
      
    } catch (error) {
      // Silent fail on polling errors
      console.debug('[SessionMonitor] Poll error:', error);
    }
  }
  
  /**
   * Send a message to the bot (for testing/simulation)
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }
    
    const res = await fetch(
      `${this.apiBase}/messaging/v1/chats/${this.session.chatId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.session.accessToken}`
        },
        body: JSON.stringify({
          msg: text,
          from_side: 'anonymous_consumer'
        })
      }
    );
    
    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.status}`);
    }
    
    // Wait a bit for bot to process
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Poll immediately for response
    await this.pollMessages();
  }
  
  /**
   * Stop polling and clean up
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[SessionMonitor] Polling stopped');
  }
  
  /**
   * End the chat session
   */
  async endSession(): Promise<void> {
    if (!this.session) return;
    
    this.stopPolling();
    
    try {
      await fetch(
        `${this.apiBase}/messaging/v1/chats/${this.session.chatId}/end`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.session.accessToken}`
          }
        }
      );
      console.log('[SessionMonitor] Session ended');
    } catch (error) {
      console.debug('[SessionMonitor] End session error:', error);
    }
    
    this.session = null;
  }
  
  /**
   * Get current session info
   */
  getSessionInfo(): SessionInfo | null {
    return this.session;
  }
  
  /**
   * Set poll interval (milliseconds)
   */
  setPollInterval(ms: number): void {
    this.pollInterval = Math.max(1000, ms); // Minimum 1 second
    
    // Restart polling with new interval if already polling
    if (this.pollTimer && this.onMessageCallback) {
      this.stopPolling();
      this.startPolling(this.onMessageCallback);
    }
  }
}

export default SessionMonitor;
