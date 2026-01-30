/**
 * Google Sheets Sync Service
 * 
 * Provides bidirectional sync between the visual editor and Google Sheets.
 * - Push local changes to Sheets
 * - Poll for remote changes and pull updates
 * - Conflict detection
 */

// Simple hash function for change detection
function hashCSV(csv: string): string {
  let hash = 0;
  for (let i = 0; i < csv.length; i++) {
    const char = csv.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

export class SheetsSyncService {
  private spreadsheetId: string;
  private pollInterval: number = 5000; // 5 seconds
  private lastKnownHash: string = '';
  private pollIntervalId: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;
  
  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
  }
  
  /**
   * Push local changes to Google Sheets
   */
  async pushToSheets(csv: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/composio/update-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: this.spreadsheetId,
          csvContent: csv,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Push failed: ${response.status}`);
      }
      
      // Update hash after successful push
      this.lastKnownHash = hashCSV(csv);
      
      return { success: true };
    } catch (error: any) {
      console.error('[SheetsSyncService] Push error:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Pull current content from Google Sheets
   */
  async pullFromSheets(): Promise<{ changed: boolean; csv: string; error?: string }> {
    try {
      const response = await fetch('/api/composio/fetch-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: this.spreadsheetId,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Fetch failed: ${response.status}`);
      }
      
      const data = await response.json();
      const remoteCSV = data.csvContent || '';
      const remoteHash = hashCSV(remoteCSV);
      
      // Check if content changed
      if (remoteHash !== this.lastKnownHash) {
        this.lastKnownHash = remoteHash;
        return { changed: true, csv: remoteCSV };
      }
      
      return { changed: false, csv: remoteCSV };
    } catch (error: any) {
      console.error('[SheetsSyncService] Pull error:', error);
      return { changed: false, csv: '', error: error.message };
    }
  }
  
  /**
   * Start polling for remote changes
   */
  startPolling(onRemoteChange: (csv: string) => void): void {
    if (this.isPolling) return;
    
    this.isPolling = true;
    console.log('[SheetsSyncService] Starting polling for', this.spreadsheetId);
    
    this.pollIntervalId = setInterval(async () => {
      const { changed, csv, error } = await this.pullFromSheets();
      
      if (error) {
        console.warn('[SheetsSyncService] Poll error:', error);
        return;
      }
      
      if (changed) {
        console.log('[SheetsSyncService] Remote change detected');
        onRemoteChange(csv);
      }
    }, this.pollInterval);
  }
  
  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.isPolling = false;
    console.log('[SheetsSyncService] Stopped polling');
  }
  
  /**
   * Set the initial hash (call after loading initial data)
   */
  setInitialHash(csv: string): void {
    this.lastKnownHash = hashCSV(csv);
  }
  
  /**
   * Check if there are unsaved local changes
   */
  hasUnsavedChanges(localCSV: string): boolean {
    return hashCSV(localCSV) !== this.lastKnownHash;
  }
}
