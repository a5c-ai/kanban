import { act, kanban } from "@a5c/not-a-real-package";
export const withKanbanTracking = (developFn) => async (task, context) => {  
  const trackingContext = kanban("create tracking context (how to comment, update, etc.) and start updating the relevant kanban boards",{
    task,
    context,
  });
  const work = await developFn(task, {trackingContext, ...context});
  const tracking = await kanban("update the relevant cards with the work done",{
    task,
    context,
    trackingContext,
  });

  return {trackingContext, work, tracking};
};

