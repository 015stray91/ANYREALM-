/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AospLayerType = 'Apps' | 'Framework Services' | 'Native Daemons' | 'HAL' | 'Kernel';

export interface AospLayer {
  id: AospLayerType;
  name: string;
  description: string;
  color: string;
  textColor: string;
}

export interface AidlMethod {
  name: string;
  returnType: string;
  parameters: { name: string; type: string; direction: 'in' | 'out' | 'inout' }[];
}

export interface AospComponent {
  id: string;
  name: string;
  layer: AospLayerType;
  type: string; // e.g. "System Service", "HAL Service", "Driver", "System App"
  description: string;
  selinuxContext: string;
  aidlMethods?: AidlMethod[];
  dependencies: string[]; // Component IDs it calls
  isCustom?: boolean;
}

export interface ComponentConnection {
  id: string;
  from: string; // Component ID
  to: string; // Component ID
  type: 'Binder IPC' | 'Direct HW Call' | 'Kernel Driver Sync' | 'JNI Binding';
  description: string;
}

export interface SimulationStep {
  componentId: string;
  title: string;
  description: string;
  actionType: 'trigger' | 'ipc' | 'process' | 'render';
}

export interface PredefinedSimulation {
  id: string;
  name: string;
  description: string;
  steps: SimulationStep[];
}

export interface GeneratedFile {
  filename: string;
  path: string;
  language: string;
  content: string;
}
