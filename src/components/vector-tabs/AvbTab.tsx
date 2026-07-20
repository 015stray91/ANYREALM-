import React from 'react';
import { ModuleVectorConfig, DeviceMetadata } from '../../types';
import { Upload } from 'lucide-react';

interface AvbTabProps {
  config: ModuleVectorConfig['avb'];
  update: (u: any) => void;
  deviceMetadata: DeviceMetadata | null;
  addLog: (m: string) => void;
  onKeyValidated: (isValid: boolean) => void;
}

export default function AvbTab({ config, update, deviceMetadata, addLog, onKeyValidated }: AvbTabProps) {
  // Simple mock parsing to extract partition size hint
  const bootSize = 67108864; // Bytes, mocked for now based on previous requirements

  const validateKey = (content: string) => {
    return content.includes('-----BEGIN RSA PRIVATE KEY-----') || content.includes('-----BEGIN PRIVATE KEY-----');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.pem')) {
      addLog('[ERROR]: Invalid key file. Please upload a .pem file.');
      onKeyValidated(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (validateKey(content)) {
        update({ keyFilename: file.name });
        addLog(`[AVB CONFIG]: Uploaded valid private key: ${file.name}`);
        onKeyValidated(true);
      } else {
        addLog('[ERROR]: Invalid RSA private key content.');
        onKeyValidated(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <label className="block text-xs text-slate-400">Private Key (.pem)</label>
      <div className="flex items-center gap-2 border border-slate-700 p-2 rounded cursor-pointer hover:bg-slate-800">
        <Upload className="w-4 h-4 text-slate-500" />
        <input 
          type="file" 
          accept=".pem"
          onChange={handleFileChange}
          className="text-xs text-slate-300 w-full"
        />
      </div>
      {config.keyFilename && (
        <p className="text-[10px] text-emerald-400">Active Key: {config.keyFilename}</p>
      )}
      
      <label className="block text-xs text-slate-400">Algorithm</label>
      <input type="text" value="SHA256_RSA2048" readOnly className="bg-slate-950 text-white text-xs p-2 rounded w-full border border-slate-900" />
      
      <label className="block text-xs text-slate-400">Discovered Partition Size</label>
      <div className="bg-slate-950 p-2 text-xs font-mono text-emerald-400 rounded border border-slate-900">
        {deviceMetadata ? `${bootSize} bytes` : 'Awaiting device...'}
      </div>
    </div>
  );
}
