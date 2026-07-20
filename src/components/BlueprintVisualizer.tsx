import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { AospComponent } from '../types';
import * as yaml from 'js-yaml';
import { Download } from 'lucide-react';

interface BlueprintVisualizerProps {
  components: AospComponent[];
}

export default function BlueprintVisualizer({ components }: BlueprintVisualizerProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const handleExportJson = () => {
    const config = {
      version: "1.0",
      components: components,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aosp-blueprint-${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportYaml = () => {
    const config = {
      name: "AOSP Architecture Build",
      on: ["push"],
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/checkout@v3" },
            {
              name: "Build Architecture",
              run: `echo "${JSON.stringify(components)}" > architecture.json && ./build-rom.sh`
            }
          ]
        }
      }
    };
    const yamlStr = yaml.dump(config);
    const blob = new Blob([yamlStr], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ci-cd-blueprint-${new Date().getTime()}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 500;

    // Transform flat components to a tree structure
    const rootData = {
      name: 'OS Architecture',
      children: [
        {
          name: 'Framework Services',
          children: components.filter(c => c.layer === 'Framework Services')
        },
        {
          name: 'Native Daemons',
          children: components.filter(c => c.layer === 'Native Daemons')
        },
        {
          name: 'HAL',
          children: components.filter(c => c.layer === 'HAL')
        },
        {
          name: 'Kernel',
          children: components.filter(c => c.layer === 'Kernel')
        },
        {
          name: 'Apps',
          children: components.filter(c => c.layer === 'Apps')
        }
      ]
    };

    const root = d3.hierarchy(rootData);
    const treeLayout = d3.tree().size([height - 100, width - 200]);
    treeLayout(root);

    const g = svg.append('g').attr('transform', 'translate(100, 50)');

    // Links
    g.selectAll('.link')
      .data(root.links())
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', '#334155')
      .attr('d', d3.linkHorizontal<any, d3.HierarchyLink<any>>()
        .source(d => d.source)
        .target(d => d.target)
        .x((d: any) => d.y)
        .y((d: any) => d.x)
      );

    // Nodes
    const nodes = g.selectAll('.node')
      .data(root.descendants())
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${(d as any).y},${(d as any).x})`);

    nodes.append('circle')
      .attr('r', 6)
      .attr('fill', '#3b82f6');

    nodes.append('text')
      .attr('dy', '0.35em')
      .attr('x', d => (d.children ? -12 : 12))
      .attr('text-anchor', d => (d.children ? 'end' : 'start'))
      .attr('fill', '#e2e8f0')
      .attr('font-size', '12px')
      .text(d => (d.data as any).name || (d.data as any).id);

    // Draggable/Zoomable
    const zoom = d3.zoom().on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoom as any);

  }, [components]);

  return (
    <div className="w-full bg-[#0b0f19] rounded-xl border border-[#1e293b] overflow-hidden">
      <div className="p-3 border-b border-[#1e293b] flex items-center justify-between">
        <span className="text-xs font-mono text-slate-400">Architecture Tree Map</span>
        <div className="flex gap-2">
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all border border-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
          <button
            onClick={handleExportYaml}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all border border-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> YAML CI/CD
          </button>
        </div>
      </div>
      <svg ref={svgRef} width="100%" height="500px" />
    </div>
  );
}
