'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
import { Settings as SettingsIcon, Bell, Key, Database, Shield, Wifi, Save, Copy, Check, Eye, EyeOff, RefreshCw } from 'lucide-react';
export default function SettingsPage() {
    const [isSaving, setIsSaving] = useState(false);
    const [copiedApiKey, setCopiedApiKey] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    // Settings state
    const [settings, setSettings] = useState({
        organizationName: 'Radio Revive',
        mqttUrl: 'mqtt://localhost:1883',
        defaultStreamUrl: 'https://ice1.somafm.com/groovesalad-256-mp3',
        heartbeatInterval: '20',
        notificationsEnabled: true,
        emailNotifications: true,
        deviceOfflineThreshold: '30',
        autoRestart: true,
        apiKey: 'rr_' + Math.random().toString(36).substring(2, 15),
    });
    const handleSave = async () => {
        setIsSaving(true);
        try {
            // TODO: Save settings to Firebase
            await new Promise(resolve => setTimeout(resolve, 1000));
            alert('Settings saved successfully!');
        }
        catch (error) {
            console.error('Failed to save settings:', error);
            alert('Failed to save settings');
        }
        finally {
            setIsSaving(false);
        }
    };
    const copyApiKey = () => {
        navigator.clipboard.writeText(settings.apiKey);
        setCopiedApiKey(true);
        setTimeout(() => setCopiedApiKey(false), 2000);
    };
    const regenerateApiKey = () => {
        if (confirm('Are you sure you want to regenerate the API key? This will invalidate the old key.')) {
            setSettings({
                ...settings,
                apiKey: 'rr_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
            });
        }
    };
    return (<div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-gray-500">Configure your Radio Revive system</p>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (<>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin"/>
              Saving...
            </>) : (<>
              <Save className="h-4 w-4 mr-2"/>
              Save Changes
            </>)}
        </Button>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5"/>
            <CardTitle>General Settings</CardTitle>
          </div>
          <CardDescription>Basic configuration for your system</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input id="org-name" value={settings.organizationName} onChange={(e) => setSettings({ ...settings, organizationName: e.target.value })}/>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="default-stream">Default Stream URL</Label>
            <Input id="default-stream" type="url" placeholder="https://stream.example.com/radio" value={settings.defaultStreamUrl} onChange={(e) => setSettings({ ...settings, defaultStreamUrl: e.target.value })}/>
            <p className="text-xs text-gray-500">
              Fallback stream URL when devices have no group assigned
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="heartbeat">Heartbeat Interval (seconds)</Label>
            <Input id="heartbeat" type="number" min="5" max="300" value={settings.heartbeatInterval} onChange={(e) => setSettings({ ...settings, heartbeatInterval: e.target.value })}/>
            <p className="text-xs text-gray-500">
              How often devices send status updates
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offline-threshold">Device Offline Threshold (seconds)</Label>
            <Input id="offline-threshold" type="number" min="10" max="600" value={settings.deviceOfflineThreshold} onChange={(e) => setSettings({ ...settings, deviceOfflineThreshold: e.target.value })}/>
            <p className="text-xs text-gray-500">
              Mark device as offline after this many seconds without heartbeat
            </p>
          </div>
        </CardContent>
      </Card>

      {/* MQTT Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5"/>
            <CardTitle>MQTT Configuration</CardTitle>
          </div>
          <CardDescription>Configure MQTT broker connection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mqtt-url">MQTT Broker URL</Label>
            <Input id="mqtt-url" placeholder="mqtt://localhost:1883" value={settings.mqttUrl} onChange={(e) => setSettings({ ...settings, mqttUrl: e.target.value })}/>
            <p className="text-xs text-gray-500">
              URL of your MQTT broker for device communication
            </p>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500"></div>
              <span className="text-sm font-medium">MQTT Status</span>
            </div>
            <Badge className="bg-green-100 text-green-800">Connected</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5"/>
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>Configure alert and notification preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Notifications</Label>
              <p className="text-xs text-gray-500">Receive alerts about system events</p>
            </div>
            <input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => setSettings({ ...settings, notificationsEnabled: e.target.checked })} className="h-4 w-4 rounded"/>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-xs text-gray-500">Send alerts via email</p>
            </div>
            <input type="checkbox" checked={settings.emailNotifications} onChange={(e) => setSettings({ ...settings, emailNotifications: e.target.checked })} className="h-4 w-4 rounded" disabled={!settings.notificationsEnabled}/>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-restart Failed Devices</Label>
              <p className="text-xs text-gray-500">Automatically restart devices that stop playing</p>
            </div>
            <input type="checkbox" checked={settings.autoRestart} onChange={(e) => setSettings({ ...settings, autoRestart: e.target.checked })} className="h-4 w-4 rounded"/>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5"/>
            <CardTitle>API Access</CardTitle>
          </div>
          <CardDescription>Manage API keys for external integrations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input type={showApiKey ? 'text' : 'password'} value={settings.apiKey} readOnly className="font-mono"/>
                <Button variant="ghost" size="sm" className="absolute right-1 top-1" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                </Button>
              </div>
              <Button variant="outline" onClick={copyApiKey}>
                {copiedApiKey ? <Check className="h-4 w-4"/> : <Copy className="h-4 w-4"/>}
              </Button>
              <Button variant="outline" onClick={regenerateApiKey}>
                <RefreshCw className="h-4 w-4"/>
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Use this key to authenticate API requests
            </p>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-medium mb-2">API Documentation</h4>
            <p className="text-xs text-gray-600 mb-2">
              Include the API key in your requests:
            </p>
            <code className="block text-xs bg-white p-2 rounded border">
              Authorization: Bearer {settings.apiKey}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Firebase Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5"/>
            <CardTitle>Firebase Configuration</CardTitle>
          </div>
          <CardDescription>Connected Firebase project details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-gray-500">Project ID</Label>
              <p className="font-mono text-sm">{process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Auth Domain</Label>
              <p className="font-mono text-sm truncate">{process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}</p>
            </div>
          </div>
          
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500"></div>
              <span className="text-sm font-medium">Firebase Status</span>
            </div>
            <Badge className="bg-green-100 text-green-800">Connected</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5"/>
            <CardTitle>Security</CardTitle>
          </div>
          <CardDescription>Security and access control settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Session Timeout</Label>
            <Select defaultValue="30">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Require 2FA for Admins</Label>
              <p className="text-xs text-gray-500">Extra security for admin accounts</p>
            </div>
            <input type="checkbox" className="h-4 w-4 rounded"/>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Log All Admin Actions</Label>
              <p className="text-xs text-gray-500">Track all administrative changes</p>
            </div>
            <input type="checkbox" defaultChecked className="h-4 w-4 rounded"/>
          </div>
        </CardContent>
      </Card>
    </div>);
}
