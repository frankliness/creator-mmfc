export const STORYBOARD_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    storyboards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          storyboard_id: {
            type: "STRING",
            description:
              "分镜唯一编号，如 s001、s002，或沿用用户给定镜号。",
          },
          duration: {
            type: "INTEGER",
            description:
              "单分镜时长（秒），只允许 10、11、12、13、14、15。",
          },
          prompt: {
            type: "STRING",
            description:
              "单分镜完整 Seedance 提示词。必须包含场景、人物、美术风格、镜头、动作、情绪、台词、声音、限制项。",
          },
          asset_bindings: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index_label: {
                  type: "STRING",
                  description: "图号，例如 图1、图2",
                },
                asset_name: {
                  type: "STRING",
                  description: "资产名称，例如 豪宅、爷爷",
                },
                asset_uri: {
                  type: "STRING",
                  description:
                    "标准化后的 asset URI，格式 asset://<ASSET_ID>",
                },
              },
              required: ["index_label", "asset_name", "asset_uri"],
            },
            description:
              "当前分镜实际用到的资产绑定列表，按 prompt 中首次出现顺序排列。",
          },
          seedance_content_items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: {
                  type: "STRING",
                  description: "固定为 image_url",
                },
                image_url: {
                  type: "OBJECT",
                  properties: {
                    url: {
                      type: "STRING",
                      description: "标准化后的 asset URI",
                    },
                  },
                  required: ["url"],
                },
                role: {
                  type: "STRING",
                  description: "固定为 reference_image",
                },
              },
              required: ["type", "image_url", "role"],
            },
            description:
              "可直接插入 Seedance Create Task content 数组的参考图对象。",
          },
        },
        required: [
          "storyboard_id",
          "duration",
          "prompt",
          "asset_bindings",
          "seedance_content_items",
        ],
      },
    },
  },
  required: ["storyboards"],
};
