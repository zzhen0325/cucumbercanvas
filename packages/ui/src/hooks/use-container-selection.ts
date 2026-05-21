import { useCallback, useEffect, useState } from 'react';
import type { ContainerManager, ContainerNode } from '@cucumber/container';

export function useContainerSelection(containerManager: ContainerManager, selectedId: string | null) {
  const [container, setContainer] = useState<ContainerNode | undefined>(undefined);

  useEffect(() => {
    if (!selectedId) {
      setContainer(undefined);
      return;
    }
    setContainer(containerManager.getContainer(selectedId));

    const unsub = containerManager.on('container:update', (node) => {
      if (node.id === selectedId) {
        setContainer({ ...node });
      }
    });
    return unsub;
  }, [containerManager, selectedId]);

  return container;
}
