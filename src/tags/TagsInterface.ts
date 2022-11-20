import { TagInterface } from "./TagInterface.ts";

export interface TagsInterface {
  tags?: TagInterface[];
}

export function addTags(target: TagsInterface, source: TagsInterface) {
  if (source.tags) {
    for (let i = 0; i < source.tags.length; i++) {
      const tag = source.tags[i];
      addTag(target, tag.name, tag.value);
    }
  }
}

export function addTag(taggable: TagsInterface, name: string, value: string) {
  let tags = taggable.tags;
  if (!tags) {
    tags = [];
    taggable.tags = tags;
  }
  const tag2 = { name: name, value: value };
  for (let i = tags.length; i--;) {
    const tag = tags[i];

    if (tag.name == name) {
      const previousValue = tag.value;

      tags[i] = tag2;
      return previousValue;
    }
  }

  tags.push(tag2);

  return null;
}

export function removeTag(taggable: TagsInterface, name: string) {
  const tags = taggable.tags;

  if (!tags) return null;

  const pos = tags.findIndex((t) => {
    return t.name == name;
  });

  if (pos < 0) return null;

  const previousTag = tags[pos];
  tags.splice(pos, 1);

  return previousTag.value;
}

export function getTag(taggable: TagsInterface, name: string) {
  const tags = taggable.tags;

  if (!tags) return null;

  const pos = tags.findIndex((t) => {
    return t.name == name;
  });

  if (pos < 0) return null;

  const tag = tags[pos];

  return tag.value;
}
