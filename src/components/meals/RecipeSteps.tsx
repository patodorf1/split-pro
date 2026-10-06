import { Lightbulb } from 'lucide-react';
import React from 'react';

import { type ParsedRecipeBody, type RecipeBlock } from '~/lib/recipeBody';

/** Texto, listas y consejos de un paso. Todo como texto de React: nada se interpreta como HTML. */
const Blocks: React.FC<{ blocks: RecipeBlock[] }> = ({ blocks }) => (
  <>
    {blocks.map((block, index) => {
      if ('list' === block.type) {
        return (
          // oxlint-disable-next-line react/no-array-index-key -- bloques fijos de un texto que no se reordena
          <ul key={index} className="list-disc pl-5 text-[15px] leading-relaxed">
            {block.items.map((item, itemIndex) => (
              // oxlint-disable-next-line react/no-array-index-key -- ítems fijos que no se reordenan
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        );
      }

      if ('tip' === block.type) {
        return (
          <p
            // oxlint-disable-next-line react/no-array-index-key -- bloques fijos que no se reordenan
            key={index}
            className="bg-muted text-muted-foreground flex gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <Lightbulb className="mt-0.5 size-4 shrink-0" />
            <span>{block.text}</span>
          </p>
        );
      }

      return (
        // oxlint-disable-next-line react/no-array-index-key -- bloques fijos que no se reordenan
        <p key={index} className="text-[15px] leading-relaxed">
          {block.text}
        </p>
      );
    })}
  </>
);

/** La introducción (ingredientes, aderezo) en una tarjeta y cada paso numerado en la suya. */
export const RecipeSteps: React.FC<{ body: ParsedRecipeBody }> = ({ body }) => (
  <div className="flex flex-col gap-2.5">
    {0 < body.intro.length ? (
      <div className="card-surface flex flex-col gap-2 px-4 py-3">
        <Blocks blocks={body.intro} />
      </div>
    ) : null}
    {body.steps.map((step) => (
      <div key={step.number} className="card-surface flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary-soft text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
            {step.number}
          </span>
          {step.title ? <p className="font-semibold">{step.title}</p> : null}
        </div>
        <Blocks blocks={step.blocks} />
      </div>
    ))}
  </div>
);
