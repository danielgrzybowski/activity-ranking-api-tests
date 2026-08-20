@rankings @scoring
Feature: Ranking skiing conditions

  Skiing needs snow, air cold enough to keep it, and wind the lifts can run
  in. The weather days below are deliberately unambiguous: a skier reading
  the numbers would give the same verdict the scenarios ask for. Where a
  scenario allows a range of ratings it is because the exact number is the
  implementation's business - the verdict a user reads is not.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities

  @smoke
  Scenario: Fresh powder with light wind is a top skiing day
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "ALPINE_POWDER_DAY"
    When I request rankings for location id "3333129"
    Then on day 1 "SKIING" is rated "EXCELLENT"
    And on day 1 "SKIING" is ranked 1
    And on day 1 the reasoning for "SKIING" mentions one of "snow, snowfall, powder"

  # 40cm of fresh snow is worthless if the lifts are on a wind hold.
  Scenario: A blizzard is not a skiing day, however much snow falls
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "BLIZZARD"
    When I request rankings for location id "3333129"
    Then on day 1 "SKIING" is rated no better than "FAIR"
    And on day 1 the reasoning for "SKIING" mentions one of "wind, gust"

  Scenario: Wind cancels out snow that would otherwise be perfect
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "ALPINE_POWDER_DAY"
    And day 2 of the forecast for "Chamonix-Mont-Blanc" is a "BLIZZARD"
    When I request rankings for location id "3333129"
    Then "SKIING" scores higher on day 1 than on day 2

  Scenario: Rain at +9C on old snow is a poor skiing day
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "SPRING_SLUSH_DAY"
    When I request rankings for location id "3333129"
    Then on day 1 "SKIING" is rated no better than "POOR"
    And on day 1 the reasoning for "SKIING" mentions one of "rain, snow, warm, °c"

  Scenario: A warm dry city day offers no skiing at all
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "PERFECT_SUMMER_DAY"
    When I request rankings for location id "3333129"
    Then on day 1 "SKIING" is rated "UNSUITABLE"
    And on day 1 "SKIING" is ranked 4
    And on day 1 the reasoning for "SKIING" mentions one of "no snow, snow"

  Scenario Outline: Skiing verdicts across representative days
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "<profile>"
    When I request rankings for location id "3333129"
    Then on day 1 "SKIING" is rated between "<lowest>" and "<highest>"

    Examples:
      | profile            | lowest     | highest    |
      | ALPINE_POWDER_DAY  | EXCELLENT  | EXCELLENT  |
      | BLIZZARD           | UNSUITABLE | FAIR       |
      | SPRING_SLUSH_DAY   | UNSUITABLE | POOR       |
      | COLD_RAIN_DAY      | UNSUITABLE | POOR       |
      | MILD_OVERCAST_DAY  | UNSUITABLE | POOR       |
      | PERFECT_SUMMER_DAY | UNSUITABLE | UNSUITABLE |
      | HEATWAVE_DAY       | UNSUITABLE | UNSUITABLE |

  # More snow, all else equal, should never rank lower. A ranking that is not
  # monotonic in its main driver is not explainable to a user.
  Scenario: More snow never scores worse than less snow
    Given day 1 of the forecast for "Chamonix-Mont-Blanc" is a "ALPINE_POWDER_DAY"
    And day 2 of the forecast for "Chamonix-Mont-Blanc" is a "MILD_OVERCAST_DAY"
    And day 3 of the forecast for "Chamonix-Mont-Blanc" is a "PERFECT_SUMMER_DAY"
    When I request rankings for location id "3333129"
    Then "SKIING" scores are in descending order across days 1, 2, 3
